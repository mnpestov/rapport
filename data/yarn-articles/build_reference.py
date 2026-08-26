# -*- coding: utf-8 -*-
"""Единый справочник артикулов пряжи -> yarn_articles_reference.json

Собирается из трёх множеств:
  1. артикулы, упомянутые в описаниях (нужны обязательно: на них ссылается
     связь «описание → пряжа», иначе она будет висеть в пустоте);
  2. каталоги магазинов и производителей, собранные из интернета;
  3. исходный справочник hollywool.ru.

Приоритет данных: производитель > магазин > справочник. У производителя
полный состав, номер спиц и плотность; у магазинов состав часто обрезан,
спиц нет вовсе.
"""
import json, csv, re, collections, io, unicodedata, sys, os

# Все пути — от каталога скрипта, а не от cwd: сборщик запускают и из корня
# репозитория, и отсюда, и результат должен быть один и тот же.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
IN = lambda n: os.path.join(HERE, n)
OUT = lambda n: os.path.join(ROOT, n)

# Разбор и нормализация живут в yarn_lib — там же, откуда их берут бэкофил
# и скрапер. Здесь только сборка файла.
sys.path.insert(0, os.path.join(ROOT, 'apps', 'backend', 'src', 'scripts'))
from yarn_lib.brands import ALIAS_RE, ALIAS_TO_BRAND
from yarn_lib.clean import (clean_line, collapse_colour_rows, tail_kind, translit,
                            dedup_key, CONFLICT_OVERRIDES)

HOMO = str.maketrans('аеосхурмвнткАЕОСХУРМВНТК', 'aeocxypmbhtkAEOCXYPMBHTK')
def key(s):
    s = unicodedata.normalize('NFKC', s or '').translate(HOMO).lower()
    s = re.sub(r'\b(concept|by)\b', '', s)
    return re.sub(r'[^a-zа-яё0-9]', '', s)

def rank(src):
    s = (src or '').lower()
    if 'производител' in s or 'lana-grossa.de' in s or 'infinity.design' in s or 'gazzalyarns' in s:
        return 3
    if 'hollywool' in s:
        return 1
    return 2                                    # магазины

# Исходная выгрузка hollywool. Раньше путь вёл в brain-каталог другого
# инструмента — единственный вход, лежавший вне репозитория (Этап 0.1).
REF_FILE = IN('yarn_articles_full.json')

rec = {}                                        # key -> запись справочника

def put(k, data, src_rank):
    old = rec.get(k)
    if old is None:
        rec[k] = data | {'_rank': src_rank}
        return
    # Поля добираем по одному: у магазина может не быть спиц, но быть состав.
    # Псевдонимы копятся со всех источников, а не выбираются лучшим:
    # «Ирина» и «Irina» одинаково настоящие.
    if data.get('aliases'):
        old['aliases'] = sorted(set(old.get('aliases') or []) | set(data['aliases']))
    for f in ('thickness_m_per_100g', 'density', 'composition', 'needle_size',
              'ball_weight_g', 'ball_length_m', 'source', 'source_url'):
        better = src_rank > old['_rank'] and data.get(f)
        if data.get(f) and (old.get(f) in (None, '') or better):
            old[f] = data[f]
    if src_rank > old['_rank']:
        old['_rank'] = src_rank
        old['brand'] = data['brand'] or old['brand']
        old['name'] = data['name'] or old['name']

# ── 1. каталоги из интернета ──────────────────────────────────────────────
# Коды цветов внутри имени снимаются ДО поштучной чистки: решение о том,
# цвет это или часть названия, принимается по группе строк, а не по одной.
_web = json.load(open(IN('web_specs.json'), encoding='utf-8'))['items']
# Ручные карточки — там, где магазинной выгрузки нет, а пряжа в описаниях
# есть. Так заведена рафия ISPIE: 105 упоминаний и ни одной карточки,
# потому что ни один разобранный магазин её не возит.
_web += json.load(open(IN('manual_cards.json'), encoding='utf-8'))['items']
print(f"  0.3c: строк с кодом цвета внутри имени: {collapse_colour_rows(_web)}")
for i in _web:
    g, m = i.get('g'), i.get('m')
    # 0.3. Чистка до вычисления ключа — иначе двадцать цветов одной пряжи
    # останутся двадцатью карточками.
    line, aliases, had_color_code = clean_line(i['brand'], i['line'])
    put(key(f"{i['brand']} {line}"), {
        'brand': i['brand'], 'name': f"{i['brand']} {line}".strip(), 'line': line,
        # Псевдонимы из строки источника добавляются к тем, что нашла
        # чистка: у проверенных вручную карточек там лежит АВТОРСКОЕ
        # написание. Без него исправление имени («Saphire» -> «Sapphire»)
        # отрезало бы ровно ту связь, ради которой карточку заводили.
        'aliases': sorted(set(aliases) | set(i.get('aliases') or [])),
        'color_variant': had_color_code,
        'thickness_m_per_100g': round(m * 100 / g) if g and m else None,
        'density': i.get('gauge'), 'composition': i.get('comp'),
        'needle_size': i.get('needle'), 'ball_weight_g': g, 'ball_length_m': m,
        'source': i['src'], 'source_url': i.get('url'),
    }, rank(i['src']))

# ── 2. исходный справочник hollywool ──────────────────────────────────────
for r in json.load(open(REF_FILE, encoding='utf-8')):
    name = re.split(r'Пряжа', r['name'])[0].strip(' ,')
    if not name or name.startswith('Журнал'):
        continue
    raw = r.get('raw_specs') or {}
    gm = re.search(r'(\d+)', raw.get('Вес', '') or '')
    mm = re.search(r'(\d+)', r.get('thickness_m_per_100g') or '')
    g = int(gm.group(1)) if gm else None
    m = int(mm.group(1)) if mm else None
    # Бренд определяем по словарю, а не «первым словом»: наивный разбор давал
    # марки вида «Drops Air» и «Casagrande Angora» — то есть бренд вместе с
    # линейкой.
    am = ALIAS_RE.search(name)
    bm = re.match(r'^([A-Za-zА-ЯЁ][\w\-]*(?: [A-Z][\w\-]*)?)', name)
    put(key(name), {
        'brand': ALIAS_TO_BRAND[am.group(1).lower()] if am else (bm.group(1) if bm else '').strip(),
        'name': name, 'line': None,
        # В файле поле называется ..._per_100g, но там метраж МОТКА, а вес
        # мотка лежит отдельно в raw_specs['Вес'] и бывает 25/50/100/150/200 г.
        'thickness_m_per_100g': round(m * 100 / g) if g and m else m,
        'density': r.get('density'), 'composition': r.get('composition'),
        'needle_size': r.get('needle_size'), 'ball_weight_g': g, 'ball_length_m': m,
        'source': 'hollywool.ru', 'source_url': r.get('url'),
    }, 1)

# ── 3. артикулы из описаний (в т.ч. без характеристик) ────────────────────
spec = {r['yarn_id']: r for r in json.load(open(IN('yarn_specs_enriched.json'), encoding='utf-8'))}
# pattern_yarns.csv и prod_details.csv — дампы, снятые с БД, и в репозитории
# их нет: вместе это шесть мегабайт, которые восстанавливаются одной командой.
# Влияют они только на `patterns_count` — число в отчёте. Без них справочник
# собирается тот же самый, поэтому отсутствие файла это предупреждение, а не
# ошибка: иначе сборка из чистого клона падала бы на ровном месте.
def optional(name):
    path = IN(name)
    if os.path.exists(path):
        return open(path, encoding='utf-8')
    print(f"  ! нет {name} — patterns_count будет нулевым")
    return io.StringIO('')

mentions = collections.Counter()
for r in csv.DictReader(optional('pattern_yarns.csv')):
    mentions[r['yarn_id']] += 1
for r in spec.values():
    if not r['line']:
        continue                                # «только бренд» — не артикул
    k = key(r['article'])
    if k not in rec:
        put(k, {'brand': r['brand'], 'name': r['article'], 'line': r['line'],
                'thickness_m_per_100g': r['m_per_100g'], 'density': r['gauge'],
                'composition': r['composition'], 'needle_size': r['needle_size'],
                'ball_weight_g': r['ball_g'], 'ball_length_m': r['ball_m'],
                'source': r['source'], 'source_url': r['source_url']}, 0)
    rec[k]['patterns_count'] = rec[k].get('patterns_count', 0) + len(
        {l for l in [1]} ) * mentions[r['yarn_id']]

# ── 4. родовые (безбрендовые) артикулы ────────────────────────────────────
# «Пух норки» — не марка, а обиходное название категории: авторы пишут просто
# «пух норки», и все понимают, о чём речь. Разбор, устроенный вокруг брендов,
# принимал эти слова за бренд и плодил мусор («Пух норки Конструкция», «Пух
# норки Пайетки») — такие записи выбрасываем и заводим по одной строке на
# родовое название. Метраж у «пуха норки» типовой (350 м / 50 г — 91 из 177
# упоминаний, где метраж указан рядом), у «эко-норки» его нет: она бывает с
# ворсом 4 и 8 см, и метраж гуляет от 330/50 до 1000/100.
for k in [k for k, v in rec.items() if v.get('brand') == 'Пух норки']:
    del rec[k]

GENERIC_RX = {
    'Пух норки': r'(?<!эко)(?<!эко[\s-])пух[ао]?[\s\-]*норк\w*|(?<!эко)(?<!эко[\s-])\bнорк[аиуе]\b|\bнорочн\w*|\bmink\b',
    'Эко-норка': r'\bэко[\s\-]?норк\w*|лебяж\w*\s+пух',
}
ECO_RX = re.compile(GENERIC_RX['Эко-норка'], re.I)
# Брендовая норка существует отдельно (Color City Норка, YarnArt Mink) и
# должна выигрывать: родовое считаем только по тем упоминаниям, что остались
# после вычёркивания брендовых.
BRANDED_RX = re.compile(r'(color\s*city|colorcity|yarn\s*art|yarnart|astra\s*premium'
                        r'|астра\s*премиум|artland|art\s*land)\s*[«"\']?\s*(норк|norka|mink|пух\s*норки)', re.I)

gcount = collections.Counter()
for row in csv.reader(optional('prod_details.csv')):
    if len(row) < 4:
        continue
    text = row[3] or ''
    if ECO_RX.search(text):
        gcount['Эко-норка'] += 1
    rest = BRANDED_RX.sub(' ', ECO_RX.sub(' ', text))
    if re.search(GENERIC_RX['Пух норки'], rest, re.I):
        gcount['Пух норки'] += 1

put(key('Пух норки'), {
    'is_generic': True,
    'brand': 'Пух норки', 'name': 'Пух норки',
    'thickness_m_per_100g': 700, 'density': None,
    'composition': '90% пух норки, 10% нейлон', 'needle_size': None,
    'ball_weight_g': 50, 'ball_length_m': 350,
    'patterns_count': gcount['Пух норки'],
    'source': 'родовое название (бренда нет); характеристики типовые',
    'source_url': None}, 3)
put(key('Эко-норка'), {
    'is_generic': True,
    'brand': 'Эко-норка', 'name': 'Эко-норка',
    'thickness_m_per_100g': None, 'density': None,
    'composition': '100% нейлон', 'needle_size': None,
    'ball_weight_g': None, 'ball_length_m': None,
    'patterns_count': gcount['Эко-норка'],
    'source': 'родовое название (бренда нет); синоним — «лебяжий пух», метраж не фиксируем',
    'source_url': None}, 3)

# ── нормализация под колонки БД ───────────────────────────────────────────
# Источники пишут одно и то же по-разному: «5.00 - 6.00 мм», «9-10 мм»,
# «2 - 3»; плотность — «17 п х 22 р», «27-32 п», «12 п. x 18 р.». В таблицу
# кладём и исходную строку (её видно человеку), и разобранные числа.
def parse_needles(t):
    if not t: return None, None
    n = [float(x.replace(',', '.')) for x in re.findall(r'\d+(?:[.,]\d+)?', t)]
    if not n: return None, None
    return min(n), max(n)

def parse_density(t):
    """-> (петель, рядов) на 10 см."""
    if not t: return None, None
    st = re.search(r'(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:п|ст)', t, re.I)
    rw = re.search(r'(\d+)(?:\s*[-–]\s*(\d+))?\s*р', t, re.I)
    def mid(m):
        if not m: return None
        a = int(m.group(1)); b = int(m.group(2)) if m.group(2) else None
        return round((a + b) / 2) if b else a
    return mid(st), mid(rw)

FROM_TEXT = (
    'из текста описаний',
    'консенсус описаний',
    'указано автором в описании',
    'сверено с метражом из описаний',
)

def from_text(src):
    """Артикул выведен из авторского текста -> в БД не едет.

    Ищем вхождение, а не начало строки: «сверено с метражом из описаний»
    стоит в скобках после чужого имени («Cardiff Cashmere Classic (сверено
    …)»), и проверка по началу их пропускала. Это те самые 11 записей —
    названия, вычитанные из текста, с метражом, одолженным у одной реальной
    карточки: все семь вариантов Cardiff и даже Aurum Cashmere получили её
    448 м/100 г. Ровно то, чего Этап 2 не должен заливать.
    """
    s = (src or '').strip().lower()
    if not s:
        # 0.4b. Пустой `source` — 259 записей. План предполагал, что это
        # семейства, пришедшие из магазинных выгрузок. Проверка показала
        # обратное и однозначно: у всех 259 ноль характеристик (ни метража,
        # ни состава, ни спиц) и все 259 упомянуты в описаниях. То есть
        # название вычитано из текста, а карточки под него не нашлось нигде.
        # Заливать нечего — в БД не едут.
        return True
    return any(t in s for t in FROM_TEXT)

# ── Авторские сокращения, которые не выводятся из названия ────────────────
# Drops продаёт хлопковую серию как «Love You 7/8/9», а в описаниях её зовут
# «You 9» и «Loves You 8» — «Love» теряется или склоняется. Ни одно правило
# сопоставления так не угадает: это не порядок слов и не опечатка, а
# устоявшееся сокращение. Заводим псевдонимами, номер берём из самого
# названия, чтобы новые выпуски серии подхватились сами.
for v in list(rec.values()):
    m = re.match(r'^Drops Love You (\d+)$', v.get('name') or '')
    if m:
        n = m.group(1)
        v['aliases'] = sorted(set(v.get('aliases') or []) |
                              {f'Drops You {n}', f'Drops Loves You {n}'})

# ── 0.3b. Цветовые варианты, у которых код срезан, а название цвета осталось ─
# «Rico Design Essentials Cotton DK banana 63», «… berry 15», «… black 90» —
# после срезания кода остаётся имя цвета, и карточка всё ещё дублирует
# родительскую. Схлопываем, но только при трёх условиях сразу, потому что под
# тот же шаблон попадают настоящие подлинейки:
#
#   1. родитель — САМЫЙ ДЛИННЫЙ префикс-карточка, а не первый попавшийся:
#      у «Casagrande Cash Tweed Ambra» родитель «Cash Tweed» (300), а не
#      «Cash» (280), и метраж надо сверять с правильным;
#   2. у родителя метраж известен и у ребёнка ТОТ ЖЕ. Это и отсекает
#      подлинейки: «Lana Grossa Cool Wool Big» — 240 против 320 у «Cool Wool»,
#      разные пряжи, остаются раздельными. У «Meilenweit» метраж пуст, и все
#      его 78 «детей» — настоящие линейки — тоже уцелеют;
#   3. у родителя не меньше трёх таких детей — одиночка скорее подлинейка;
#   4. и главное — у ребёнка при чистке БЫЛ срезан цветовой код. Без этого
#      условия правило съедало настоящие подлинейки: «Lana Grossa Cool Wool»
#      поглотил Alpaca, Cashmere, Seta, Vintage и ещё пять — все с метражом
#      320, но это разные пряжи с разным составом. Метраж у подлинеек одной
#      марки совпадает сплошь и рядом, а цветового кода у них не бывает.
#
# Имя ребёнка уходит в псевдонимы: автор вполне может написать цвет.
def _stem(name, have):
    w = name.split()
    for k in range(len(w) - 1, 1, -1):           # от длинного префикса к короткому
        p = ' '.join(w[:k])
        if p in have:
            return p
    return None

# Карта слияний: «имя, которого больше нет» -> «имя, которое его заменило».
# Нужна не для отчёта: импорт умеет только добавлять, и без этой карты слитая
# карточка останется в БД вместе со своими связями, то есть слияние не
# доедет до продукта вовсе.
MERGED = []

_by_name = {v['name']: k for k, v in rec.items()}
_kids = collections.defaultdict(list)
for k, v in rec.items():
    p = _stem(v['name'], _by_name)
    if p:
        _kids[p].append(k)

# Сначала СОБИРАЕМ пары, ничего не удаляя: карточка бывает одновременно
# ребёнком одной группы и родителем другой («Cash Tweed» под «Cash», но сам
# родитель для «Cash Tweed Ambra»). Удали её по ходу — и её собственные дети
# осиротеют, а слияние упадёт на несуществующем ключе.
_plan = {}                                      # ключ ребёнка -> ключ родителя
for parent, ks in _kids.items():
    if len(ks) < 3:
        continue
    pv = rec[_by_name[parent]]
    if pv.get('thickness_m_per_100g') is None:
        continue
    for k in ks:
        v = rec[k]
        if v['brand'] != pv['brand'] or \
           v.get('thickness_m_per_100g') != pv['thickness_m_per_100g']:
            continue
        # Магазинную карточку в текстовую не сливаем. У слитой останется
        # источник родителя, и она перестанет ехать в БД — вместе со своими
        # связями. Так «Cardiff Cashmere Classic» (реальная карточка с
        # filloryyarn, 12 связей) ушла в «Cardiff Cashmere» — одну из тех 11
        # записей, что вычитаны из текста и в БД не едут по 0.4.
        if not from_text(v.get('source')) and from_text(pv.get('source')):
            continue
        if not v.get('color_variant'):
            continue
        _plan[k] = _by_name[parent]

# Родителя не сливаем, пока у него есть остающиеся дети — иначе группа
# схлопнется через одно звено и потеряет промежуточное название.
_parents = set(_plan.values())
_plan = {k: p for k, p in _plan.items() if k not in _parents}

for k, pk in _plan.items():
    pv, v = rec[pk], rec[k]
    pv['aliases'] = sorted(set(pv.get('aliases') or []) | {v['name']}
                           | set(v.get('aliases') or []))
    pv['patterns_count'] = pv.get('patterns_count', 0) + v.get('patterns_count', 0)
    MERGED.append({'from': v['name'], 'into': pv['name'], 'kind': 'colour_code'})
    del rec[k]
print(f"  0.3b: цветовых вариантов слито:      {len(_plan)}")

# ── 0.3d. Оттенок и способ окраски отдельной карточкой ────────────────────
# 0.3b ловит только те цветовые строки, где магазин поставил код («001»,
# «02.015»). Без кода — «Essentials Cotton DK banana», «Every Day 1411
# Cream», «Angora Gold Batik» — карточка доезжала до справочника как
# самостоятельная пряжа. Отличие от 0.3b ещё и в охвате: там правило
# работает по магазинным СТРОКАМ, здесь по собранным карточкам, поэтому
# сюда попадают и записи из manual_cards.json.
#
# Признак не «похоже на цвет», а «хвост состоит из цветовых слов И у
# родителя тот же метраж»: подлинейка отличается составом при том же
# названии, и по одному имени её от оттенка не отличить.
_by_name = {v['name']: k for k, v in rec.items()}
_kids = collections.defaultdict(list)
for k, v in rec.items():
    p = _stem(v['name'], _by_name)
    if p:
        _kids[p].append(k)

_plan_d, _dye = {}, set()
for parent, ks in _kids.items():
    pv = rec[_by_name[parent]]
    if pv.get('thickness_m_per_100g') is None:
        continue
    kinds = {k: tail_kind(rec[k]['name'][len(parent):]) for k in ks}
    # Голое число — цвет только если группа это подтверждает: у «Katia Linen»
    # десять таких детей, а «Lang Yarns Merino 120» одинок и остаётся сам.
    if sum(1 for v in kinds.values() if v in ('code', 'colour')) < 3:
        kinds = {k: (None if v == 'code' else v) for k, v in kinds.items()}
    for k, kind in kinds.items():
        v = rec[k]
        if not kind or v['brand'] != pv['brand']:
            continue
        if v.get('thickness_m_per_100g') != pv['thickness_m_per_100g']:
            continue
        if not from_text(v.get('source')) and from_text(pv.get('source')):
            continue
        _plan_d[k] = _by_name[parent]
        if kind == 'dye':
            _dye.add(k)

_parents_d = set(_plan_d.values())
_plan_d = {k: p for k, p in _plan_d.items() if k not in _parents_d}

_n_colour = _n_dye = 0
for k, pk in _plan_d.items():
    pv, v = rec[pk], rec[k]
    # Имя оттенка в псевдонимы не идёт: «... banana 63» никто не пишет, а
    # список псевдонимов — это ещё и регулярка поиска, её незачем раздувать
    # на 245 строк. Способ окраски пишут полностью, поэтому он остаётся.
    if k in _dye:
        pv['aliases'] = sorted(set(pv.get('aliases') or []) | {v['name']}
                               | set(v.get('aliases') or []))
        _n_dye += 1
    else:
        _n_colour += 1
    pv['patterns_count'] = pv.get('patterns_count', 0) + v.get('patterns_count', 0)
    MERGED.append({'from': v['name'], 'into': pv['name'],
                   'kind': 'dye' if k in _dye else 'colour'})
    del rec[k]
print(f"  0.3d: оттенков слито:               {_n_colour}, способов окраски: {_n_dye}")

# ── 0.5 / 0.6. Свести дубли и разрешить коллизии ключа ────────────────────
# Два разных схлопывания, и порядок между ними существенен.
#
#   0.6 — коллизия `normalizedKey`: два имени после транслитерации дают ОДИН
#         ключ. В БД `normalizedKey` уникален, поэтому нерешённая коллизия
#         означает, что одна из строк молча исчезнет при заливке.
#   0.5 — группа `dedupKey`: имена разные и ключи разные, но состоят из тех
#         же слов («Baby Cotton XL» / «Baby XL Cotton»).
#
# После чистки 0.3 обе категории почти опустели: коллизия осталась одна и она
# конфликтная (решается списком CONFLICT_OVERRIDES), групп dedupKey — 11, и
# во всех метраж совпадает, то есть сливаются механически. Первая редакция
# плана ожидала здесь 14 групп и четыре коллизии — счёт снимался до чистки.
def _norm_words(name):
    """Имя -> список нормализованных слов.

    Через key() напрямую нельзя: он вычищает и пробелы тоже, всё имя
    становится одним токеном, и любая группировка «по составу слов»
    вырождается в сравнение целых строк.
    """
    s = unicodedata.normalize('NFKC', name or '').translate(HOMO).lower()
    s = re.sub(r'\b(concept|by)\b', ' ', s)
    return re.findall(r'[a-z0-9]+', translit(s))

def _nkey(name):
    return ''.join(_norm_words(name))

def _merge_into(dst_k, src_k):
    d, v = rec[dst_k], rec[src_k]
    d['aliases'] = sorted(set(d.get('aliases') or []) | {v['name']}
                          | set(v.get('aliases') or []))
    d['patterns_count'] = d.get('patterns_count', 0) + v.get('patterns_count', 0)
    for f in ('thickness_m_per_100g', 'density', 'composition', 'needle_size',
              'ball_weight_g', 'ball_length_m', 'source', 'source_url'):
        if not d.get(f) and v.get(f):
            d[f] = v[f]
    MERGED.append({'from': v['name'], 'into': d['name'], 'kind': 'duplicate'})
    del rec[src_k]

_by_name = {v['name']: k for k, v in rec.items()}
for src_name, dst_name in CONFLICT_OVERRIDES.items():
    if src_name in _by_name and dst_name in _by_name:
        _merge_into(_by_name[dst_name], _by_name[src_name])
print(f"  0.6:  конфликтов ключа разрешено вручную: {len(CONFLICT_OVERRIDES)}")

_groups = collections.defaultdict(list)
for k, v in rec.items():
    _groups[dedup_key(_norm_words(v['name']))].append(k)

_dedup, _left = 0, 0
for ks in _groups.values():
    if len({_nkey(rec[k]['name']) for k in ks}) < 2:
        continue
    ms = {rec[k].get('thickness_m_per_100g') for k in ks} - {None}
    if len(ms) > 1:
        _left += 1                              # конфликт данных — не молча
        print("        КОНФЛИКТ, не слито: " +
              " | ".join(rec[k]['name'] for k in ks))
        continue
    keep = max(ks, key=lambda k: (rec[k].get('patterns_count', 0),
                                  -len(rec[k]['name'])))
    for k in ks:
        if k != keep:
            _merge_into(keep, k)
            _dedup += 1
print(f"  0.5:  дублей по составу слов слито:  {_dedup}"
      + (f" (конфликтных групп осталось {_left})" if _left else ""))

# ── 0.4. Кто едет в БД ────────────────────────────────────────────────────
# Раньше это выводили из `source` на глаз, и 11 записей с авторским метражом
# молча попадали в «магазинные». Правило теперь явное и живёт одним списком:
# всё, кроме перечисленного, — карточка продавца или производителя.
out = []
for n, (k, v) in enumerate(sorted(rec.items(),
                                  key=lambda kv: (-kv[1].get('patterns_count', 0), kv[1]['name'].lower())), 1):
    v.pop('_rank', None)
    out.append({'yarn_id': f"Y{n:04d}", 'brand': v['brand'], 'name': v['name'],
                'thickness_m_per_100g': v.get('thickness_m_per_100g'),
                'density': v.get('density'), 'composition': v.get('composition'),
                'needle_size': v.get('needle_size'),
                'needle_min_mm': parse_needles(v.get('needle_size'))[0],
                'needle_max_mm': parse_needles(v.get('needle_size'))[1],
                'density_stitches': parse_density(v.get('density'))[0],
                'density_rows': parse_density(v.get('density'))[1],
                'ball_weight_g': v.get('ball_weight_g'), 'ball_length_m': v.get('ball_length_m'),
                'patterns_count': v.get('patterns_count', 0),
                'source': v.get('source'), 'source_url': v.get('source_url'),
                'line': v.get('line'),
                'aliases': v.get('aliases') or [],
                'is_generic': bool(v.get('is_generic')),
                'is_shop': not from_text(v.get('source'))})

_alive = {r['name'] for r in out}
for m in MERGED:
    seen, into = {m['from']}, m['into']
    while into not in _alive and into not in seen:
        seen.add(into)
        nxt = next((x['into'] for x in MERGED if x['from'] == into), None)
        if not nxt:
            break
        into = nxt
    m['into'] = into
MERGED = [m for m in MERGED if m['into'] in _alive and m['from'] not in _alive]
json.dump(MERGED, open(OUT('yarn_articles_merged.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

json.dump(out, open(OUT('yarn_articles_reference.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
with open(OUT('yarn_articles_reference.csv'), 'w', encoding='utf-8', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)

def filled(f): return sum(1 for r in out if r[f])
print(f"артикулов в справочнике: {len(out)}")
print(f"  с толщиной нити (м/100 г): {filled('thickness_m_per_100g')}")
print(f"  с составом:                {filled('composition')}")
print(f"  с плотностью:              {filled('density')}")
print(f"  с толщиной спиц:           {filled('needle_size')}")
print(f"  упоминаются в описаниях:   {filled('patterns_count')}")
print(f"  брендов:                   {len({r['brand'] for r in out if r['brand']})}")
