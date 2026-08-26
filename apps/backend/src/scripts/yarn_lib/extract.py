# -*- coding: utf-8 -*-
"""Артикулы пряжи из Pattern.details — версия 2.

Отличия от первой попытки (поле Yarns в исходном json):
  • якорь — бренд, а не слово «пряжа». От слова «пряжа» разбор давал обрывки
    фраз («/100 гр», «и инструменты:», «20% полиамид») — 10107 уникальных
    строк на 15454 записи, то есть каталога из них не собрать;
  • варианты написания сводятся в один артикул (Supersoft = Super Soft =
    SUPER SOFT);
  • второй проход подбирает линейки, названные без бренда, но только
    однозначные (Como — всегда Lamana; Air — и Drops, и Infinity, поэтому нет);
  • тип пряжи (рафия, пух норки, мохер) собирается ОТДЕЛЬНО: это не артикул.
"""
import json, re, collections, csv, unicodedata

from .brands import BRANDS, ALIAS_TO_BRAND, ALIAS_RE, STOP_WORDS, TOKEN, METRAGE

SRC = None  # входной файл задаёт вызывающий; библиотека сама ничего не читает

# Линейка в кавычках сразу после марки: «Камтекс «Альма»».
QUOTED_TAIL = re.compile(r'^\s*[«"“„\'](\s*[^»"”\']{2,40})[»"”\']')

# Тип пряжи — не артикул: это сырьё/фактура. Границы слов обязательны, иначе
# «льн» ловится внутри «сильный», а «лен» — внутри «колен».
TYPES = {
    'Рафия':            r'\bрафи[яию]\w*',
    'Пух норки':        r'\bпух\w*\s+норки|\bнорков\w+\s+пух',
    'Кид-мохер':        r'\bкид[\s\-]?мохер\w*|\bкидмохер\w*',
    'Мохер':            r'\bмохер\w*',
    'Кашемир':          r'\bкашемир\w*',
    'Меринос':          r'\bмеринос\w*',
    'Альпака':          r'\bальпак\w+',
    'Хлопок':           r'\bхлоп(?:ок|ка|ковы\w+)\b',
    'Лён':              r'\bл[ёе]н\b|\bльн[яе]\w*',
    'Шёлк':             r'\bш[ёе]лк\w*',
    'Ангора':           r'\bангор\w+',
    'Твид':             r'\bтвид\w*',
    'Полиэфирный шнур': r'\bполиэфирн\w+\s+шнур\w*|\bшнур\w*\s+полиэфирн\w+',
}

# Кириллические буквы, неотличимые от латинских на вид. В текстах они
# попадаются внутри латинских названий («Lanagold Finе» — «е» кириллическая),
# и без сведения к одному виду это два разных артикула.
HOMOGLYPHS = str.maketrans('аеосхурмвнткАЕОСХУРМВНТК', 'aeocxypmbhtkAEOCXYPMBHTK')

def norm_key(s):
    """Ключ для склейки вариантов: без регистра, пробелов, знаков и гомоглифов."""
    s = unicodedata.normalize('NFKC', s).translate(HOMOGLYPHS).lower()
    return re.sub(r'[^a-zа-яё0-9]', '', s)

# Размеры и обозначения толщины, которые пишутся капсом по существу.
KEEP_UPPER = {'XL', 'XXL', 'XS', 'S', 'M', 'L', 'DK', 'XXXL', 'SW'}

def pretty(line):
    """Единый вид написания: Заглавная Буква В Каждом Слове.

    Иначе один и тот же артикул показывается то как «LOVE ME», то как
    «Love me» — какое написание чаще встретилось в тексте, такое и попало бы
    в каталог.
    """
    out = []
    for t in line.split():
        if t.upper() in KEEP_UPPER or re.search(r'\d', t):
            out.append(t.upper() if t.upper() in KEEP_UPPER else t)
        else:
            out.append(t[:1].upper() + t[1:].lower())
    return ' '.join(out)

LATIN = re.compile(r'[A-Za-z]')
CYR = re.compile(r'[А-ЯЁа-яё]')
# Мусор, который остаётся одним словом после бренда и линейкой не является.
JUNK_LINE = {'free', 'new', 'yarn', 'yarns', 'design', 'дизайн', 'пряжа', 'пряжи',
             'арт', 'art', 'the', 'либо', 'или'}

UNIT = {'м','m','г','гр','g','м.','гр.','г.'}
# «м/100», «г/50» — единица, приклеенная к следующему числу.
UNIT_PREFIX = re.compile(r'^(м|m|гр|г|g)\s*[/\\-]\s*\d')

def clean_line(tokens, script=None, allow_stop=False):
    """Собрать название линейки из хвоста после бренда.

    Правило одного алфавита: у латинского бренда линейка латинская, у
    кириллического — кириллическая. Без него в имя затекало соседнее
    предложение («Drops Air Приблизительный», «Laines du Nord Pima Cotton
    Длина») — там как раз смена алфавита на границе.
    """
    out = []
    for tok in tokens:
        low = tok.lower().strip('.')
        if not low or (low in STOP_WORDS and not allow_stop):
            break
        # Метраж и расход: всё, где цифра соседствует с единицей измерения
        # или дробью («105гр/50», «125м/50гр», «8/9/10/11»).
        if re.search(r'\d', low) and (re.search(r'(г|гр|м|g|m|%)', low) or '/' in low):
            break
        if re.fullmatch(r'\d+[-–]\d*', low):          # диапазон расхода: «120-130»
            break
        # Голое число — только как суффикс уже начатого имени: Angora 80.
        if re.fullmatch(r'\d{1,3}', low):
            # Число как суффикс имени (Angora 80) берём, но только если за ним
            # не следует единица измерения: «Toskana 200 м / 50 г» — здесь
            # 200 это метраж, а не часть названия.
            nxt = tokens[tokens.index(tok) + 1].lower().strip('.') if tokens.index(tok) + 1 < len(tokens) else ''
            # Единица измерения бывает СКЛЕЕНА со следующим числом: токенизатор
            # отдаёт «м/100» одним куском, и проверка на точное совпадение с
            # UNIT его не узнавала. Из-за этого «Vita Saphire 250 м/100 г»
            # давало артикул «Vita Saphire 250» — число из метража въезжало в
            # название, и карточка «Vita Sapphire» переставала находиться.
            if not out or nxt in UNIT or UNIT_PREFIX.match(nxt):
                break
            out.append(tok); continue
        if re.fullmatch(r'\d+([.,]\d+)?', low):
            break
        tok_script = 'lat' if LATIN.search(tok) else ('cyr' if CYR.search(tok) else None)
        if tok_script:
            if script is None:
                script = tok_script
            elif tok_script != script:
                break
        if low.strip('.') in {'арт', 'art'}:          # «Loro Piana art. Cashmere»
            continue
        out.append(tok.strip('.,;:'))
        if len(out) == 4:
            break
    while out and out[-1].lower() in JUNK_LINE:
        out.pop()
    line = ' '.join(out).strip(' -–—')
    if len(line) < 3 or line.lower() in JUNK_LINE:
        return ''
    return line

# Латинские бренды авторы иногда набирают с кириллическими буквами-двойниками:
# «Сeam Toskana» — здесь «С» кириллическая, и ALIAS_RE такое не находит.
# Таблица посимвольная, длина строки не меняется, поэтому позиции совпадений
# в нормализованном тексте те же, что в исходном, и подставлять в результат
# можно оригинальный фрагмент.
LOOKALIKE = str.maketrans('АВЕКМНОРСТУХасеорхукмнтв', 'ABEKMHOPCTYXaceopxykmhtb')

def _alias_hits(text):
    """Совпадения бренда с учётом кириллических двойников.

    Ищем дважды: по исходному тексту (там кириллические бренды — Пехорка,
    Семёновская) и по нормализованному (там латинские, набранные вперемешку).
    Позиции совпадают, поэтому дубли схлопываем по началу совпадения.
    """
    seen = {}
    for src in (text, text.translate(LOOKALIKE)):
        for m in ALIAS_RE.finditer(src):
            seen.setdefault(m.start(), m)
    return [seen[k] for k in sorted(seen)]


def extract_brand_hits(text):
    for m in _alias_hits(text):
        brand = ALIAS_TO_BRAND[m.group(1).lower()]
        raw_tail = text[m.end():m.end() + 70]
        # «Камтекс «Альма»», «Пехорка «Жемчужная»», «Alize «Lanagold fine»» —
        # линейка взята в кавычки. Кавычка стоит в списке сильных
        # разделителей ниже, и хвост обрывался на ней в пустоту: описание
        # получало «названа только марка», хотя линейка написана прямо тут.
        # 77 упоминаний в базе. Берём содержимое кавычек как хвост, дальше
        # всё как обычно — правило всё равно проверит его по справочнику.
        quoted = QUOTED_TAIL.match(raw_tail)
        if quoted:
            raw_tail = quoted.group(1)
        tail = re.split(r'[,;:•▪️()\[\]«»"“”|]| - |–|—', raw_tail, maxsplit=1)[0]
        # Обрезаем по следующему бренду: без этого имя перескакивало через
        # границу перечисления — «Nako Callico Семеновская Village»,
        # «Троицкая Фиджи Пехорка Элегантная».
        nxt = ALIAS_RE.search(tail)
        if nxt:
            tail = tail[:nxt.start()]
        # Алфавит задаёт БРЕНД: у латинского бренда линейка латинская.
        # Иначе из «Infinity Design ЛИБО ЛЮБАЯ ДРУГАЯ пряжа» получался
        # артикул «Infinity Design Либо Любая Другая».
        # Ограничение по алфавиту снимается, когда линейка взята в кавычки:
        # там граница задана явно, догадываться не о чем. Иначе у латинской
        # марки с русским названием линейки — «Astra Premium “Кашемировая”»,
        # марка русская, пишется латиницей — правило обрывало имя в пустоту.
        script = None if quoted else ('cyr' if CYR.search(brand) else 'lat')
        # В кавычках снимается и запрет на слова-типы: «мохер», «хлопок»,
        # «кашемир» лежат в STOP_WORDS, потому что сами по себе артикулом не
        # являются, — но «Astra Premium “Мохер”» это именно название товара,
        # и автор обозначил его кавычками явно. Придумать лишнего правило не
        # может: имя всё равно проверяется по справочнику.
        line = clean_line(TOKEN.findall(tail), script, allow_stop=bool(quoted))
        if not line:
            # Бренд назван без линейки: «Рафия (ISPIE 250м/120г)», «пряжа Drops».
            # У части брендов это и есть весь артикул (ISPIE — рафия одного
            # вида), у остальных — единственное, что удалось узнать. Берём
            # только рядом со словом о пряже, чтобы не подхватить название
            # магазина из соседнего абзаца.
            around = text[max(0, m.start()-60):m.end()+60]
            # Сам метраж рядом — такой же признак разговора о пряже, как и
            # слово «пряжа». Без него «Air Drops, 150м/50гр» отбрасывалось
            # целиком: слова о пряже в строке нет, и до правила «линейка
            # перед маркой» дело не доходило.
            if not (re.search(r'пряж|нит[ьи]|рафи|метраж|мотк|состав', around, re.I)
                    or METRAGE.search(around)):
                continue
        window = text[m.start():m.end()+90]
        mm = METRAGE.search(window)
        yield brand, line, text[m.start():m.end()+len(line)+1].strip(), (mm.group(0) if mm else '')

def extract_art_hits(text):
    # После «арт» обязателен либо точка, либо пробел. С необязательной
    # точкой правило цепляло начало любого слова на «арт»: «Астра
    # Арт|емида», «другие арт|икулы» — 30 ложных срабатываний против 115
    # верных, и все они уходили в список нераспознанного обрывками.
    for m in re.finditer(r'\bарт(?:\.\s*|\s+)([A-ZА-ЯЁ][\w\- ]{2,30}?)(?=[,\.\(]|\s+от\s+|\s+\d|$)', text, re.I):
        name = m.group(1).strip()
        bm = ALIAS_RE.search(text[m.end():m.end()+40])
        brand = ALIAS_TO_BRAND[bm.group(1).lower()] if bm else ''
        mm = METRAGE.search(text[m.start():m.end()+90])
        yield brand, name, m.group(0).strip(), (mm.group(0) if mm else '')

def main():
    data = json.load(open(SRC, encoding='utf-8'))
    texts = {p['id']: re.sub(r'\s+', ' ', p.get('details') or '') for p in data}

    # ── проход 1: бренд + линейка ────────────────────────────────────────
    hits = collections.defaultdict(list)          # pattern_id -> [(brand, line, raw, metrage)]
    for p in data:
        for h in list(extract_brand_hits(texts[p['id']])) + list(extract_art_hits(texts[p['id']])):
            hits[p['id']].append(h)

    # ── карта «линейка -> бренды» для второго прохода ────────────────────
    line_brands = collections.defaultdict(set)
    line_display = {}
    for lst in hits.values():
        for brand, line, _, _ in lst:
            if brand:
                k = norm_key(line)
                line_brands[k].add(brand)
                line_display.setdefault(k, line)
    unambiguous = {k: next(iter(v)) for k, v in line_brands.items()
                   if len(v) == 1 and len(k) >= 4}

    # ── проход 2: линейка названа без бренда ─────────────────────────────
    # Смотрим только то, что стоит СРАЗУ после слова «пряжа/нить», и сверяем
    # с картой линеек — иначе это перебор 1500 названий по каждому тексту
    # (2 млн регулярок, минуты работы вместо секунды).
    NEAR = re.compile(r'(?:пряж\w*|нит[ьи]|нитк\w*)\W{0,15}([A-Za-zА-ЯЁа-яё][\w\- ]{2,28})', re.I)
    recovered = 0
    for p in data:
        if hits[p['id']]:
            continue
        for cand in NEAR.findall(texts[p['id']]):
            toks = cand.split()
            for take in (3, 2, 1):                       # сначала длинное совпадение
                k = norm_key(' '.join(toks[:take]))
                if k in unambiguous:
                    disp = line_display[k]
                    mm = METRAGE.search(texts[p['id']])
                    hits[p['id']].append((unambiguous[k], disp, cand.strip(), mm.group(0) if mm else ''))
                    recovered += 1
                    break
            if hits[p['id']]:
                break

    # ── каталог артикулов ────────────────────────────────────────────────
    catalog = {}
    for pid, lst in hits.items():
        for brand, line, _, _ in lst:
            key = (brand, norm_key(line))
            e = catalog.setdefault(key, {'brand': brand, 'variants': collections.Counter(), 'patterns': set()})
            e['variants'][line] += 1
            e['patterns'].add(pid)

    # Числовой хвост, встретившийся один-два раза, — это почти всегда метраж,
    # приросший к имени («Drops Air 50»), а не часть артикула. Склеиваем с
    # основным, если тот в каталоге есть и встречается чаще. «Casagrande
    # Angora 80» и «Alize Lanagold 100» так не пострадают: они частотные.
    merged = 0
    for key in list(catalog):
        brand, k = key
        m = re.fullmatch(r'(.*?)(\d{1,3})', k)
        if not m or not m.group(1):
            continue
        base = (brand, m.group(1))
        if base in catalog and len(catalog[key]['patterns']) <= 2 and len(catalog[base]['patterns']) > len(catalog[key]['patterns']):
            catalog[base]['patterns'] |= catalog[key]['patterns']
            catalog[base]['variants'].update(catalog[key]['variants'])
            del catalog[key]
            merged += 1

    yarn_rows, yarn_id = [], {}
    for i, (key, e) in enumerate(sorted(catalog.items(), key=lambda kv: -len(kv[1]['patterns'])), 1):
        display = pretty(e['variants'].most_common(1)[0][0])
        yid = f"Y{i:04d}"
        yarn_id[key] = yid
        yarn_rows.append({'yarn_id': yid, 'brand': e['brand'], 'line': display,
                          'article': f"{e['brand']} {display}".strip(),
                          'patterns': len(e['patterns']),
                          'variants': len(e['variants']),
                          'spellings': ' | '.join(v for v, _ in e['variants'].most_common(4))})

    # ── связи ────────────────────────────────────────────────────────────
    link_rows, seen = [], set()
    by_id = {p['id']: p for p in data}
    for pid, lst in hits.items():
        for brand, line, raw, metrage in lst:
            key = (brand, norm_key(line))
            if key not in yarn_id:                     # ушёл в склейку числовых хвостов
                m = re.fullmatch(r'(.*?)(\d{1,3})', key[1])
                if m and (brand, m.group(1)) in yarn_id:
                    key = (brand, m.group(1))
            if (pid, key) in seen:
                continue
            seen.add((pid, key))
            link_rows.append({'pattern_id': pid, 'title': by_id[pid]['title'], 'author': by_id[pid].get('author', ''),
                              'yarn_id': yarn_id[key], 'article': f"{brand} {pretty(line)}".strip(),
                              'metrage': metrage, 'raw': raw[:80]})

    # ── типы пряжи (отдельно) ────────────────────────────────────────────
    type_rows = []
    for p in data:
        for name, rx in TYPES.items():
            if re.search(rx, texts[p['id']], re.I):
                type_rows.append({'pattern_id': p['id'], 'title': p['title'], 'type': name})

    # Что осталось без артикула — чтобы было видно, где предел текста, а не
    # разбора: у большей части этих описаний пряжа названа только типом
    # («рафия», «пух норки») или не названа вовсе.
    covered_ids = {r['pattern_id'] for r in link_rows}
    typed_ids = {r['pattern_id'] for r in type_rows}
    gap_rows = [{'pattern_id': p['id'], 'title': p['title'], 'author': p.get('author', ''),
                 'has_type': 'да' if p['id'] in typed_ids else '',
                 'mentions_yarn': 'да' if re.search(r'пряж|нит[ьи]|метраж', texts[p['id']], re.I) else '',
                 'details_len': len(texts[p['id']])}
                for p in data if p['id'] not in covered_ids]

    for fn, rows in [('yarns_catalog.csv', yarn_rows), ('pattern_yarns.csv', link_rows),
                     ('pattern_yarn_types.csv', type_rows), ('patterns_without_yarn.csv', gap_rows)]:
        with open(fn, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader(); w.writerows(rows)

    covered = len({r['pattern_id'] for r in link_rows})
    typed = len({r['pattern_id'] for r in type_rows})
    print(f"описаний: {len(data)}")
    print(f"с артикулом: {covered} ({100*covered/len(data):.0f}%), из них подобрано вторым проходом: {recovered}")
    print(f"с типом пряжи (артикул может отсутствовать): {typed} ({100*typed/len(data):.0f}%)")
    print(f"артикулов в каталоге: {len(yarn_rows)} | связей: {len(link_rows)} | склеено числовых хвостов: {merged}")
    return yarn_rows, link_rows

if __name__ == '__main__':
    main()
