# -*- coding: utf-8 -*-
"""Разбор одного описания: какие артикулы в нём названы.

Общая точка для бэкофила существующих описаний и скрапера новинок. Раньше
логика жила прямо в бэкофиле, и повторить её в скрапере значило бы завести
вторую копию: одно и то же описание давало бы разные связи в зависимости от
того, кто его обработал.
"""
import collections
import hashlib
import re

from .keys import norm_key

# Хэштег: решётка и всё, что за ней до пробела или знака препинания.
HASHTAG = re.compile(r'#[^\s#,;.!?()\[\]«»"“”]+')

Link = collections.namedtuple(
    'Link', 'yarn_id yarn_name normalized_key raw_mention metrage rule')
Mention = collections.namedtuple(
    'Mention', 'raw_text metrage kind suggested_yarn_id rule')


def metrage_per_100g(text):
    """«50 г/150 м» -> 300. Нужен правилу опечаток как подтверждение."""
    if not text:
        return None
    a = re.search(r'(\d+)\s*(?:г|гр)\D{0,4}(\d+)\s*м', text, re.I)
    b = re.search(r'(\d+)\s*м\D{0,4}(\d+)\s*(?:г|гр)', text, re.I)
    if a:
        g, m = int(a.group(1)), int(a.group(2))
    elif b:
        m, g = int(b.group(1)), int(b.group(2))
    else:
        return None
    return round(m * 100 / g) if g else None


def details_hash(text):
    return hashlib.sha256((text or '').encode('utf-8')).hexdigest()[:16]


def analyze(details, index, extract_brand_hits, extract_art_hits):
    """-> (список Link, список Mention).

    Порядок правил задан в match.YarnIndex и здесь не дублируется. Родовое
    идёт последним и по тексту целиком — остальные работают по конкретному
    упоминанию.
    """
    # Хэштеги вычёркиваем до всякого разбора. Это метка описания, а не
    # список материалов: «#drops_air» называет модель автора, а не заявляет,
    # что вязали из Drops Air. Без этого «#katia_cotton» давал связь на
    # Katia Cotton, а «#аура_annabaron» — артикул «Aura Yarns annabaron».
    # В сегодняшнем корпусе таких хэштегов нет, поэтому правка ничего не
    # меняет в числах — она закрывает дорогу, а не чинит существующее.
    text = HASHTAG.sub(' ', details or '')
    text = re.sub(r'\s+', ' ', text)
    links, mentions = [], []
    seen_yarn, seen_mention = set(), set()
    seen_brands = set()          # марки, по которым связь уже есть

    for brand, line, raw, metrage in list(extract_brand_hits(text)) + list(extract_art_hits(text)):
        if line:
            article = f"{brand} {line}".strip() if brand else line
            card, rule = index.lookup(article)
            if not card:
                # Сверенное исправление — раньше догадок правил: оно точнее
                # любой из них, потому что проверено человеком.
                card = index.lookup_correction(article)
                rule = 'CORRECTION' if card else None
            if card:
                if card['id'] not in seen_yarn:
                    seen_yarn.add(card['id'])
                    if card.get('brand'):
                        seen_brands.add(norm_key(card['brand']))
                    links.append(Link(card['id'], card['name'], card['normalized_key'],
                                      raw, metrage, rule))
                continue
            # Последняя попытка: карточка может быть названа полнее, с
            # материнской маркой впереди («Schachenmayr Regia Premium
            # Silk» при авторском «Regia Premium Silk»). Сюда доходит
            # только то, что не нашли все правила выше, — вытеснить чужую
            # связь эта попытка не может.
            card = index.lookup_parent_brand(article)
            if card:
                if card['id'] not in seen_yarn:
                    seen_yarn.add(card['id'])
                    if card.get('brand'):
                        seen_brands.add(norm_key(card['brand']))
                    links.append(Link(card['id'], card['name'], card['normalized_key'],
                                      raw, metrage, 'EXACT'))
                continue

            card = index.lookup_typo(article, metrage_per_100g(metrage))
            if card:
                if card['id'] not in seen_yarn:
                    seen_yarn.add(card['id'])
                    if card.get('brand'):
                        seen_brands.add(norm_key(card['brand']))
                    links.append(Link(card['id'], card['name'], card['normalized_key'],
                                      raw, metrage, 'EXACT'))
                continue

            if article not in seen_mention:
                seen_mention.add(article)
                kind = 'FAMILY' if index.is_family(article) else 'UNKNOWN_ARTICLE'
                mentions.append(Mention(article, metrage, kind, None, None))
            continue

        # «Пух норки» лежит в словаре марок разбора — исторически, оттуда и
        # пошли мусорные карточки «Пух норки Пайетки». Без этой проверки
        # описание получало бы и связь по родовому правилу, и упоминание
        # «названа только марка» на то же самое название: 84 случая из 870.
        # Родовое правило ниже разберётся само.
        if index.is_generic_name(brand):
            continue

        # Прежде чем сдаться — вдруг линейка стоит перед маркой:
        # «Rasta Malabrigo (150гр/82м)». Правило принимает только точное
        # попадание в справочник, поэтому ошибиться в пользу
        # несуществующего артикула не может.
        card = index.lookup_before(text, brand)
        if card:
            if card['id'] not in seen_yarn:
                seen_yarn.add(card['id'])
                links.append(Link(card['id'], card['name'], card['normalized_key'],
                                  raw, metrage, 'EXACT'))
            continue

        # Названа только марка: связь допустима лишь там, где выбор линейки
        # не меняет метража, — иначе непонятно, какую из десятков имели в виду.
        card = index.lookup_brand(brand)
        if card:
            if card['id'] not in seen_yarn:
                seen_yarn.add(card['id'])
                links.append(Link(card['id'], card['name'], card['normalized_key'],
                                  raw, metrage, 'BRAND_LEVEL'))
        elif brand and brand not in seen_mention:
            seen_mention.add(brand)
            mentions.append(Mention(brand, metrage, 'BRAND_ONLY', None, None))

    for card in index.lookup_generic(text):
        if card['id'] not in seen_yarn:
            seen_yarn.add(card['id'])
            links.append(Link(card['id'], card['name'], card['normalized_key'],
                              None, None, 'GENERIC'))

    # Последним — линейки, названные без марки. Правило ищет в свободном
    # тексте, поэтому опирается не на разбор, а на метраж, который автор
    # написал сам: совпал с карточкой — связь, нет — молчим.
    for card, raw in index.lookup_lines(text):
        if card['id'] not in seen_yarn:
            seen_yarn.add(card['id'])
            links.append(Link(card['id'], card['name'], card['normalized_key'],
                              raw, None, 'AUTHOR_METRAGE'))

    # Второй проход: убираем «названа только марка» там, где по этой марке
    # связь у описания уже есть. Значит линейку автор назвал в другом месте,
    # а здесь просто повторил марку — в рабочий список такое не добавляет
    # ничего: непонятно, какой карточки не хватает, потому что не хватает
    # никакой. Фильтруем именно в конце, а не по ходу: марка без линейки
    # часто стоит в тексте РАНЬШЕ, чем полное название, и проверка на лету
    # ловила бы только половину случаев.
    linked_brands = {norm_key(b) for b in seen_brands if b}
    mentions = [m for m in mentions
                if not (m.kind == 'BRAND_ONLY' and norm_key(m.raw_text) in linked_brands)]
    return links, mentions


def load_index(cur, YarnIndex):
    """Справочник в память — 2209 строк, один раз за прогон.

    Запрос не для онлайнового пути: правило «частичное» ищет подстроку с
    нашей стороны, индексом это не покрывается, и делать так на каждый
    запрос каталога нельзя. Скрапер и бэкофил работают пачкой офлайн.
    """
    cur.execute("""
        SELECT y.id, y.name, y."normalizedKey", y.brand, y."isGeneric", y."mPer100g",
               array_remove(array_agg(a."normalizedAlias"), NULL) AS aliases
          FROM "Yarn" y
          LEFT JOIN "YarnAlias" a ON a."yarnId" = y.id
         WHERE y."isActive" AND y."mergedIntoId" IS NULL
         GROUP BY y.id
    """)
    return YarnIndex([{
        'id': r[0], 'name': r[1], 'normalized_key': r[2], 'brand': r[3],
        'is_generic': r[4], 'm_per_100g': r[5], 'aliases': r[6],
    } for r in cur.fetchall()])
