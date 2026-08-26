# -*- coding: utf-8 -*-
"""Извлечение артикулов пряжи из Pattern.details.

Подход: якорь — БРЕНД, а не слово «пряжа». Слово «пряжа» в тексте стоит где
угодно («пряжа и расход», «оригинальная пряжа», «пряжу можно купить»), и разбор
от него даёт обрывки фраз — что и видно в текущем Yarns: 10107 уникальных строк
на 15454 записи, среди них «/100 гр», «и инструменты:», «20% полиамид».
Бренд же однозначен, а линейка всегда идёт сразу за ним.
"""
import json, re, collections, csv, sys

# ── Словарь брендов ───────────────────────────────────────────────────────
# Каноническое имя -> варианты написания (в т.ч. кириллицей и слитно).
# Собран по частотности в самом корпусе, а не по памяти.
BRANDS = {
    'Lana Grossa':   ['lana grossa', 'lanagrossa', 'лана гросса', 'lana gossa'],
    'Lana Gatto':    ['lana gatto', 'lanagatto', 'лана гатто'],
    'Alize':         ['alize', 'ализе'],
    'Gazzal':        ['gazzal', 'газзал', 'гаццал'],
    'Drops':         ['drops', 'дропс'],
    'Lang Yarns':    ['lang yarns', 'langyarns', 'ланг ярнс'],
    'Katia':         ['katia'],
    'Concept by Katia': ['concept by katia', 'concept'],
    'Infinity Design': ['infinity design', 'infinity', 'инфинити'],
    'Aura Yarns':    ['aura yarns', 'aura', 'аура'],
    'YarnArt':       ['yarnart', 'yarn art', 'ярнарт'],
    'Vereskovaya':   ['veresk', 'вереск'],
    'Casagrande':    ['casagrande', 'casa grande', 'казагранде'],
    'Kremke':        ['kremke'],
    'Sandnes Garn':  ['sandnes garn', 'sandnes', 'сандес', 'sandes garn', 'sandes'],
    'Fibra Natura':  ['fibranatura', 'fibra natura'],
    'BBB Filati':    ['bbb filati', 'bbb'],
    'Lamana':        ['lamana'],
    'Lanecardate':   ['lanecardate'],
    'Rico Design':   ['rico design', 'rico'],
    'Schachenmayr':  ['schachenmayr'],
    'Zegna Baruffa': ['zegna baruffa', 'zegna'],
    'Cascade':       ['cascade'],
    'Himalaya':      ['himalaya', 'хималая'],
    'Laines du Nord':['laines du nord', 'laines'],
    'Seam':          ['seam', 'сеам', 'ceam'],
    'Vita':          ['vita cotton', 'vita'],
    'Astra':         ['astra', 'астра'],
    'Nako':          ['nako', 'нако'],
    'Loro Piana':    ['loro piana'],
    'Austermann':    ['austermann'],
    'Etrofil':       ['etrofil'],
    'Regia':         ['regia'],
    'Cardiff':       ['cardiff'],
    'Biagioli':      ['biagioli'],
    'CaMaRose':      ['camarose', 'ca ma rose'],
    'Onion':         ['onion'],
    'Lanerossi':     ['lanerossi', 'lane rossi'],
    'Millefili':     ['millefili'],
    'Filcolana':     ['filcolana'],
    'Rellana':       ['rellana'],
    'Пехорка':       ['пехорка', 'пехорский'],
    'Троицкая':      ['троицкая'],
    'Семёновская':   ['семеновская', 'семёновская'],
    'Камтекс':       ['камтекс'],
    'Color City':    ['color city', 'колор сити'],
    'Кауни':         ['kauni', 'кауни'],
    'Пряжа из Троицка': ['пряжа из троицка'],
    'Malabrigo':     ['malabrigo'],
    # Марки скандинавского ассортимента pryaja.ru. Названия из двух-трёх
    # слов и в тексте ни с чем не путаются. «Orion» из того же каталога
    # сюда НЕ попал сознательно: в описаниях это слово встречается только
    # как «Vita Orion» и «Vita cotton Orion» — линейка другой марки, и
    # псевдоним перетянул бы их на перуанский Orion.
    'Dale Garn':     ['dale garn'],
    'Du Store Alpakka': ['du store alpakka'],
    'Bergere de France': ['bergere de france', 'bergère de france'],
    'Anny Blatt':    ['anny blatt'],
    'Cheval Blanc':  ['cheval blanc'],
    # Псевдоним длиннее уже имеющегося 'astra', а ALIAS_RE перебирает их от
    # длинных к коротким — значит «Astra Premium “Кашемировая”» разберётся
    # как эта марка, а не как Astra с линейкой «Premium».
    'Astra Premium': ['astra premium', 'астра премиум'],
    'Rowan':         ['rowan'],
    'Isager':        ['isager'],
    'Holst':         ['holst garn', 'holst'],
    'Novita':        ['novita'],
    'BC Garn':       ['bc garn'],
    'Pascuali':      ['pascuali'],
    'Schoppel':      ['schoppel'],
    'Ferner':        ['ferner'],
    'Sesia':         ['sesia'],
    'Mondial':       ['mondial'],
    'Borgo de Pazzi':['borgo de pazzi', 'borgo'],
    'Madame Tricote':['madame tricote'],
    'Alpina':        ['alpina'],
    'Knoll Yarns':   ['knoll yarns', 'knoll'],
    'Jamieson':      ['jamieson'],
    'Shibui':        ['shibui'],
    'Manos':         ['manos del uruguay', 'manos'],
    'G&G':           ['g&g'],
    'Kutnor':        ['kutnor', 'кутнор'],
    'Filcom':        ['filcom'],
    # Добрано по описаниям, где старый разбор что-то находил, а разбор по
    # брендам молчал: их просто не было в словаре. ISPIE — самый частый
    # пропуск (рафия, 91 упоминание).
    'ISPIE':          ['ispie', 'испи'],
    'Hamanaka':       ['hamanaka', 'хаманака'],
    'Gruppo Filpucci':['gruppo filpucci', 'filpucci'],
    'Urth Yarns':     ['urth yarns', 'urth'],
    'Jody Long':      ['jody long'],
    'Aurum':          ['aurum'],
    'Artland':        ['artland'],
    'Beleeka':        ['beleeka', 'белеека'],
    'Piu Bella':      ['piu bella'],
    'Vento d\'Italia':['vento d\'italia', 'vento ditalia', 'vento italia'],
    'Monsun':         ['monsun'],
    # Найдены разбором описаний, где пряжа названа, а марки не было в словаре.
    'Knitfashion':    ['knitfashion', 'книтфэшн'],
    'Regina':         ['regina', 'регина'],
    'King Cole':      ['king cole'],
    'New Mill':       ['new mill'],
    'Пух норки':      ['пух норки', 'норковый пух'],
    # Найдены сверкой с каталогом kudel.ru: марки, которые встречаются и в
    # описаниях (Performance — 33 описания, Ecafil Best — 12, Queensland — 12,
    # Permin — 5), но в словаре их не было.
    'Performance':    ['performance'],
    'Queensland':     ['queensland'],
    'Ecafil Best':    ['ecafil best', 'ecafil'],
    'Permin':         ['permin'],
}

# Слова, на которых название линейки заканчивается: дальше идёт уже не имя.
STOP_WORDS = set('''и или в на для с по от из а но что это все весь цвет цвета
состав расход метраж вес моток мотка мотков нить нити нитей нитку в две три
или аналог аналоги замена заменить подойдет подойдёт например также плотность
спицы крючок номер размер купить магазин заказать ссылка примерно около
шерсть меринос хлопок лен лён вискоза альпака мохер кашемир шелк шёлк акрил
полиамид полиэстер бамбук кид супервош гр г м см шт руб рублей'''.split())

TOKEN = re.compile(r'[A-Za-zА-ЯЁа-яё0-9][A-Za-zА-ЯЁа-яё0-9&/\-\.]*')
# Метраж/вес рядом с названием — «(50 г/175 м)», «100г/1550м», «390 м/100 гр».
METRAGE = re.compile(r'(\d+\s*(?:г|гр|g)\s*/\s*\d+\s*(?:м|m)\b)|(\d+\s*(?:м|m)\s*/\s*\d+\s*(?:г|гр|g)\b)', re.I)

ALIAS_TO_BRAND = {}
for canon, aliases in BRANDS.items():
    for a in aliases:
        ALIAS_TO_BRAND[a] = canon
# Длинные псевдонимы проверяем первыми: «lana gatto» должен выиграть у «lana».
ALIASES_SORTED = sorted(ALIAS_TO_BRAND, key=len, reverse=True)
ALIAS_RE = re.compile(r'(?<![A-Za-zА-ЯЁа-яё])(' + '|'.join(re.escape(a) for a in ALIASES_SORTED) + r')(?![A-Za-zА-ЯЁа-яё])', re.I)


def clean_line(tokens):
    """Из хвоста после бренда собрать название линейки."""
    out = []
    for tok in tokens:
        low = tok.lower().strip('.').strip()
        if not low:
            break
        if low in STOP_WORDS:
            break
        if re.fullmatch(r'\d+([.,]\d+)?', low):        # голое число — это расход/метраж
            break
        if re.fullmatch(r'\d+\s*(г|гр|м|g|m|%)', low):
            break
        if re.match(r'^\d+/\d+$', low):
            break
        out.append(tok.strip('.,;:'))
        if len(out) == 4:
            break
    # Хвостовые служебные куски вида «арт», «art»
    while out and out[-1].lower() in {'арт', 'art'}:
        out.pop()
    return ' '.join(out).strip(' -–—')


def extract(details):
    """-> список (бренд, линейка, исходное упоминание, метраж|None)"""
    text = re.sub(r'\s+', ' ', details or '')
    found = []
    for m in ALIAS_RE.finditer(text):
        brand = ALIAS_TO_BRAND[m.group(1).lower()]
        tail = text[m.end():m.end() + 70]
        # Отрезаем по первому «сильному» разделителю — дальше уже другая мысль.
        tail = re.split(r'[,;:•▪️\(\)\[\]«»"“”\n\|]| - |–|—', tail, maxsplit=1)[0]
        line = clean_line(TOKEN.findall(tail))
        window = text[m.start():m.end() + 90]
        mm = METRAGE.search(window)
        found.append((brand, line, text[m.start():m.end() + len(line) + 1].strip(), mm.group(0) if mm else None))

    # «арт. CANBERRA от Lanecardate», «Пряжа: арт. Lino, 390 м/100 гр»
    for m in re.finditer(r'\bарт\.?\s*([A-ZА-ЯЁ][\w\- ]{2,30}?)(?=[,\.\(]|\s+от\s+|\s+\d|$)', text, re.I):
        name = m.group(1).strip()
        after = text[m.end():m.end() + 40]
        bm = ALIAS_RE.search(after)
        brand = ALIAS_TO_BRAND[bm.group(1).lower()] if bm else None
        window = text[m.start():m.end() + 90]
        mm = METRAGE.search(window)
        found.append((brand, name, m.group(0).strip(), mm.group(0) if mm else None))
    return found


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'patterns_with_details_enriched.json'
    data = json.load(open(src, encoding='utf-8'))
    rows = []
    for p in data:
        seen = set()
        for brand, line, raw, metrage in extract(p.get('details')):
            key = (brand or '', line.lower())
            if not line or key in seen:
                continue
            seen.add(key)
            rows.append({'pattern_id': p['id'], 'title': p['title'], 'author': p.get('author'),
                         'brand': brand or '', 'line': line, 'raw': raw, 'metrage': metrage or ''})
    return data, rows


if __name__ == '__main__':
    data, rows = main()
    covered = len({r['pattern_id'] for r in rows})
    print(f"описаний: {len(data)}; с найденной пряжей: {covered} ({100*covered/len(data):.0f}%)")
    print(f"связей: {len(rows)}; уникальных (бренд+линейка): {len({(r['brand'], r['line'].lower()) for r in rows})}")
    c = collections.Counter(f"{r['brand']} {r['line']}".strip() for r in rows)
    print("\nсамые частые артикулы:")
    for s, n in c.most_common(25):
        print(f"  {n:4}  {s}")
