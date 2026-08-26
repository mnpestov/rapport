# -*- coding: utf-8 -*-
"""Чистка названий из магазинных выгрузок — Этап 0.3.

Живёт здесь, а не в готовом `yarn_articles_reference.json`: сборщик формирует
`name` как «бренд + линейка» заново при каждом прогоне, и правка в готовом
файле исчезла бы. Применяется к `line` ДО вычисления ключа — иначе двадцать
цветов одной пряжи так и останутся двадцатью карточками.

Каждое правило проверено на выгрузке; там, где похожий шаблон встречается и в
настоящих названиях, правило сужено до безопасного, а не обобщено.
"""
import re

# «Fall/Winter» в хвосте — сезонный ярлык каталога Lana Grossa, протёкший в
# название при выгрузке: 78 записей. Режем только в конце строки, иначе
# пострадает настоящая «Winter Softness».
SEASON = re.compile(r'\s*\b(fall|spring|autumn|summer)\s*/\s*(winter|summer|spring)\s*$', re.I)

# Цветовой код вида «07.002» и всё, что за ним: «Touch Me 07.002 Silver grey».
# 110 строк схлопываются в 14 карточек.
#
# Важно: код «просто число в конце» НЕ трогаем. Под него попадают
# «Alize Lanagold 800», «Gazzal Baby Cotton 205», «Lang Yarns Merino 120» —
# 335 записей, где число является частью названия (и половина из них в списке
# VARIANT, §Этап 5.1).
COLOR_CODE = re.compile(r'\s*\b\d{2}[.,]\d{3}\b.*$')

# «A-elita quatro / Аэлита кватро» — пара «оригинал / транслитерация»,
# 14 записей, все «Семёновская». Левая половина остаётся названием, правая
# уходит в YarnAlias: выбрасывать её нельзя, авторы пишут и так, и так.
BILINGUAL = re.compile(r'^([^/]*?[A-Za-z][^/]*?)\s*/\s*([^/]*[А-Яа-яЁё][^/]*)$')

# Цветовой код без точки — «Cash Tweed Ambra 012», «Baby Alpaca 008».
# Отличается от номера в названии ВЕДУЩИМ НУЛЁМ, и это разделяет набор
# начисто: 255 карточек с «0NN» — все до одной цвета Casagrande и Alize,
# 239 карточек с числом без нуля — все до одной настоящие названия
# («Angora 80», «Cash 20», «Wooltime 100», «Concept Cashmere 10»).
# Поэтому правило смотрит именно на ноль, а не на «число в конце».
COLOR_NUM = re.compile(r'\s+0\d{2,3}$')


def clean_line(brand, line):
    """-> (очищенная линейка, псевдонимы, был ли срезан цветовой код).

    Третье значение нужно слиянию цветовых вариантов: только строка, у
    которой код действительно срезан, может оказаться цветом одной и той же
    пряжи. Подлинейка («Cool Wool Alpaca», «Baby Cotton Organic») кода не
    имела и под слияние попадать не должна — иначе она исчезает в родителе,
    хотя это отдельный товар со своим составом.
    """
    line = (line or '').strip()
    aliases = []

    line = SEASON.sub('', line)
    had_code = bool(COLOR_CODE.search(line) or COLOR_NUM.search(line))
    line = COLOR_CODE.sub('', line)
    line = COLOR_NUM.sub('', line)

    m = BILINGUAL.match(line)
    if m and not re.search(r'[А-Яа-яЁё]', m.group(1)):
        line = m.group(1).strip()
        aliases.append(f"{brand} {m.group(2).strip()}".strip())

    # «Семёновская» + «Семёновская Kable» -> «Семёновская Kable».
    # Сравниваем с ПОЛНЫМ брендом, а не с отдельным его словом: у
    # «Tropical Lane» линейка «Tropical cotton 5» — там повтора нет, и
    # срезание первого слова испортило бы настоящее название.
    b = (brand or '').strip()
    if b and line.lower().startswith(b.lower() + ' '):
        line = line[len(b):].strip()

    return re.sub(r'\s{2,}', ' ', line).strip(' ,-'), aliases, had_code


# ── Транслитерация для ключей (§3.3) ──────────────────────────────────────
# Авторы пишут «ализе» и «Alize» вперемешку, поэтому ключ сравнения обязан
# приводить оба алфавита к одному. Гомоглифы (кириллическая «а» вместо
# латинской) снимаются раньше, в HOMO у сборщика.
_TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
    'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}


def translit(s):
    return ''.join(_TRANSLIT.get(c, c) for c in (s or '').lower())


def dedup_key(normalized_words):
    """Ключ дедупа — отсортированное МНОЖЕСТВО токенов (§3.3).

    Множество, а не мультимножество: оно схлопывает и переставленный порядок
    слов («Baby Cotton XL» / «Baby XL Cotton»), и задвоенный бренд
    («Infinity Design Design Air»). Мультимножество второе не ловит.
    """
    return '|'.join(sorted(set(normalized_words)))


# ── 0.6. Ручные решения там, где данные противоречат друг другу ───────────
# Ключ — нормализованное имя карточки, которую УБИРАЕМ; значение — имя той,
# в которую сливаем, и причина. Список крошечный намеренно: всё, что можно
# решить правилом, решается правилом выше.
CONFLICT_OVERRIDES = {
    # «Детский каприз тёплый» — 50 г / 125 м. Карточка с 450 м/100 г
    # (50 г / 225 м) повторяет характеристики базового «Детского каприза»:
    # при разборе карточка «тёплого» подхватила чужие цифры. Верна та, что
    # с 250, и на неё же приходится больше упоминаний (7 против 3).
    'Пехорка Детский Каприз Тёплый': 'Пехорка Детский Каприз Теплый',

    # Три написания «органического» хлопка Gazzal — на самом деле ДВА разных
    # товара, и метраж их разводит:
    #   Organic Baby Cotton / Baby Organic Cotton — 50 г / 115 м, 100% хлопок;
    #   Baby Cotton Organic — 50 г / 165 м, 60% хлопок + 40% акрил, то есть
    #   ровно характеристики обычного «Baby Cotton». Это pryazha.su
    #   перечислила базовую пряжу под сбившимся именем, а не органическую.
    # Поэтому первое сливаем с органической, второе — с обычной.
    'Gazzal Baby Organic Cotton': 'Gazzal Organic Baby Cotton',
    'Gazzal Baby Cotton Organic': 'Gazzal Baby Cotton',

    # Написания через «е» и «ё» дают ОДИН ключ (транслитерация сводит обе
    # буквы к «e»), и в БД `normalizedKey` уникален — заливка на такой паре
    # останавливается. Побеждает написание производителя: он же и назвал
    # пряжу. Метраж «Льна» при этом меняется с магазинных 360 на заводские
    # 330 — по тому же правилу приоритета источников.
    'Камтекс Лен': 'Камтекс Лён',
    'Камтекс Мотылек': 'Камтекс Мотылёк',
}


# ── Цвет, записанный после кода ───────────────────────────────────────────
# «Luxury Pure Baby Alpaca 001 cream» — код цвета стоит НЕ в конце, за ним
# идёт название цвета. Правило COLOR_NUM привязано к концу строки и такое
# пропускало, поэтому девять линеек лежали в справочнике десятками карточек
# на цвет, а обычное «Rico Design Luxury Pure Baby Alpaca» не находилось.
#
# Резать «от кода до конца» нельзя: у соседней линейки магазин продублировал
# код — «Essentials Baby Alpaca 009 Merino aran 009», — и «Merino aran» это
# часть имени, а не цвет. Отличить их можно только по группе: цвет тем и
# отличается, что МЕНЯЕТСЯ у строк с одинаковыми характеристиками, а часть
# имени у всех одна.
CODE_ANY = re.compile(r'\s+0\d{2,3}\b')


def collapse_colour_rows(items):
    """Убрать коды цветов и хвосты-цвета из линеек. Меняет items на месте."""
    coded = []
    for it in items:
        line = (it.get('line') or '')
        if not CODE_ANY.search(line):
            continue
        it['line'] = re.sub(r'\s{2,}', ' ', CODE_ANY.sub(' ', line)).strip()
        coded.append(it)

    groups = {}
    for it in coded:
        groups.setdefault((it.get('brand'), it.get('m'), it.get('g')), []).append(it)

    cut = 0
    for members in groups.values():
        if len(members) < 3:
            continue
        words = [ (it['line'] or '').split() for it in members ]
        # Самая длинная общая приставка, при которой у каждой строки остаётся
        # не больше двух лишних слов: названия цветов короткие («smokey blue»),
        # а вот подлинейка так не выглядит. Порог в три строки отсекает пары,
        # где «общее» может оказаться совпадением.
        for k in range(min(len(w) for w in words), 1, -1):
            head = words[0][:k]
            same = [w for w in words if w[:k] == head]
            if len(same) < 3 or not any(len(w) > k for w in same):
                continue
            if any(len(w) - k > 2 for w in same):
                continue
            for it, w in zip(members, words):
                if w[:k] == head:
                    it['line'] = ' '.join(head)
                    cut += 1
            break
    return cut


# ── Оттенок и способ окраски, заведённые отдельной карточкой ──────────────
# Правила выше срезают цвет только там, где есть код вида «001» или «02.015».
# Магазины пишут цвет и без кода — «Essentials Cotton DK banana», «Every Day
# 1411 Cream», — и такие строки доезжали до справочника самостоятельными
# карточками: 245 штук на 302 линейки.
#
# Отдельно стоит способ окраски: «Batik», «Print», «Melange», «Degrade»,
# «Колор», «Ассорти». Это та же пряжа, покрашенная иначе, и в справочнике ей
# отдельная запись не нужна — но имя автор пишет полностью, поэтому оно
# уходит в псевдонимы, а не выбрасывается.
#
# Что сюда НЕ входит: «All Seasons», «Tweed», «Cashmere», «Silk», «Uni»,
# «Vintage». Это подлинейки — другой состав при том же метраже. Слить их с
# базовой линейкой значит повторить ошибку, из-за которой «Cool Wool» съел
# «Cool Wool Alpaca».
COLOUR_WORDS = set("""
white black grey gray silver cream ecru natural naturale beige sand camel taupe brown
chocolate coffee caramel banana lemon yellow gold mustard orange apricot peach coral salmon
rose pink fuchsia magenta red cherry burgundy bordeaux wine purple violet lilac lavender mauve
plum blue navy denim petrol teal turquoise aqua mint green olive khaki forest anthracite ivory
nude powder stone marine azur azure indigo rust terracotta bronze copper smokey
weiss schwarz grau silber creme natur braun gelb rot rosa lila blau oliv nebel wolke stein
bianco nero grigio rosso blu verde giallo marrone panna
белый чёрный черный серый бежевый коричневый жёлтый желтый оранжевый красный розовый
малиновый сиреневый фиолетовый синий голубой бирюзовый зелёный зеленый салатовый молочный
кремовый песочный терракотовый бордовый персиковый мятный лимонный васильковый графит
""".split())
# «soft» и «medium» сюда не входят, хотя выглядят как оттеночные приставки:
# это названия подлинеек («YarnArt Linen Soft», «Regia Premium Alpaca Soft»,
# «Brushed Medium Weight»). Обе стоили по связи на первом же прогоне.
HUE_PREFIX = re.compile(r'^(light|dark|hell|dunkel|pale|deep|bright|св|тём|тем)', re.I)

DYE_WORDS = {'batik', 'print', 'melange', 'mélange', 'degrade', 'degradé', 'ombre', 'color',
             'colors', 'colour', 'colours', 'multi', 'multicolor', 'multicolour', 'hand dyed',
             'hand-dyed', 'handdyed', 'ассорти', 'колор', 'принт', 'мулине', 'цветная',
             'цветной', 'мультиколор'}


def tail_kind(tail):
    """Хвост имени -> 'colour' | 'dye' | None."""
    t = (tail or '').strip()
    if not t:
        return None
    if t.lower() in DYE_WORDS:
        return 'dye'
    words = [w for w in re.split(r'[\s/,-]+', t) if w]
    # Названия цветов короткие. Три слова допускаются только вместе с кодом
    # («108 pearl pink»): без кода такой длины бывают уже подлинейки.
    has_code = any(re.fullmatch(r'\d+[a-zа-я]?', w.strip('.').lower()) for w in words)
    if not words or len(words) > (3 if has_code else 2):
        return None
    known = unknown = 0
    for w in words:
        y = w.strip('.').lower()
        if re.fullmatch(r'\d+[a-zа-я]?', y):
            continue
        if y in COLOUR_WORDS or HUE_PREFIX.match(y):
            known += 1
        else:
            unknown += 1
    # Оттенки описывают словами, которых в списке нет («108 pearl pink»,
    # «204 dusty rose»). Одно незнакомое слово рядом с кодом И знакомым
    # цветом — всё ещё цвет. Двух не бывает: «009 Merino aran» — это часть
    # имени, и как раз на нём проверяется, что правило не слишком широкое.
    if unknown and not (has_code and known and unknown == 1):
        return None
    # Одно голое число двусмысленно: «Katia Linen 36» — цвет, а «Lang Yarns
    # Merino 120» — толщина в названии. По самой строке их не различить,
    # решает группа: цвет тем и отличается, что таких «детей» у линейки много.
    # Ответ 'code' означает «цвет, если группа подтвердит».
    if len(words) == 1 and re.fullmatch(r'\d+', words[0]):
        return 'code'
    return 'colour'
