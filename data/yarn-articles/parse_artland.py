# -*- coding: utf-8 -*-
"""pryazha.online (марка ArtLand) -> web_specs.json.

Сохранённая страница марки — это каталог РАСЦВЕТОК, а не линеек: 376
«товаров» с именами вида «51 белый», «04 ярко-розовый». Ни названия
линейки, ни метража в листинге нет — характеристики там только про цвет,
упаковку и состав словами, без долей.

Всё нужное лежит на карточке товара, и главное поле — «Коллекция»: именно
оно называет пряжу («Aura»). Плюс «Состав» с процентами, «Длина нити на вес
мотка» и «Вес 1 шт». Поэтому обходим карточки и схлопываем их по коллекции:
376 расцветок дают несколько линеек.

Расхождения внутри одной коллекции (разные метражи у разных цветов) не
усредняем, а печатаем — это признак, что коллекция объединяет разные
пряжи, и решать должен человек.
"""
import collections, json, os, re, sys, time

import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'artland')
OUT = os.path.join(HERE, 'web_specs.json')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(HERE)), 'ARTLAND.html')
H = {'User-Agent': 'Mozilla/5.0'}

FIELD = {
    'коллекция': 'collection',
    'состав': 'comp',
    'длина нити на вес мотка': 'm',
    'вес 1 шт': 'g',
}


# «Вес 1 шт» приходит и в граммах, и в килограммах — 361 карточка против
# десяти. Без разбора единицы «1 кг» превращалось в 1 грамм, и «Супер
# толстая» получала 4000 м/100 г вместо четырёх.
def grams(value):
    if not value:
        return None
    m = re.search(r'([\d.,]+)\s*(кг|г)\b', value, re.I)
    if not m:
        return None
    n = float(m.group(1).replace(',', '.'))
    return round(n * 1000) if m.group(2).lower() == 'кг' else round(n)


# Поле «Коллекция» иногда перечисляет несколько через запятую («Aura,
# Christmas 50 г») — товар состоит и в сезонной подборке тоже. Линейка это
# первая: у всех трёх таких карточек характеристики совпадают с обычной
# «Aura». Хвост про фасовку («Рафия 40г*10» — десять мотков по 40 г) к
# названию пряжи тоже не относится.
PACK = re.compile(r'\s*\d+\s*(?:г|гр)\s*[*х x]\s*\d+\s*$', re.I)


def clean_collection(value):
    name = (value or '').split(',')[0].strip()
    return PACK.sub('', name).strip()


def fetch(url, path):
    if os.path.exists(path):
        return open(path, encoding='utf-8').read()
    r = requests.get(url, headers=H, timeout=30)
    r.raise_for_status()
    open(path, 'w', encoding='utf-8').write(r.text)
    time.sleep(0.35)
    return r.text


def read_card(html):
    soup = BeautifulSoup(html, 'html.parser')
    out = {}
    for lab in soup.select('.c-value__label-text'):
        key = lab.get_text(' ', strip=True).strip(':').strip().lower()
        if key not in FIELD:
            continue
        val = lab.find_next(class_='c-value__value-text')
        if val:
            out[FIELD[key]] = val.get_text(' ', strip=True)
    return out


os.makedirs(CACHE, exist_ok=True)
listing = BeautifulSoup(open(SRC, encoding='utf-8', errors='ignore').read(), 'html.parser')
urls = []
for a in listing.select('.c-product-thumb__name a[href]'):
    if '/product/' in a['href']:
        urls.append(a['href'])
print(f"расцветок в листинге: {len(urls)}")

groups = collections.defaultdict(list)
failed = 0
for u in urls:
    fn = os.path.join(CACHE, re.sub(r'[^\w]+', '_', u.split('/product/')[-1])[:80] + '.html')
    try:
        card = read_card(fetch(u, fn))
    except Exception:
        failed += 1
        continue
    coll = clean_collection(card.get('collection'))
    if not coll:
        continue
    m = re.search(r'(\d+)', card.get('m') or '')
    groups[coll].append((int(m.group(1)) if m else None,
                         grams(card.get('g')),
                         (card.get('comp') or '').strip() or None))

rows = []
for coll, vals in sorted(groups.items()):
    ms = {v[0] for v in vals if v[0]}
    gs = {v[1] for v in vals if v[1]}
    comps = {v[2] for v in vals if v[2]}
    if len(ms) > 1 or len(gs) > 1:
        print(f"  РАСХОЖДЕНИЕ в «{coll}»: метражи {sorted(ms)}, веса {sorted(gs)} — не заливаем")
        continue
    rows.append({
        'brand': 'ArtLand', 'line': coll,
        # Состав берём самый подробный: у части расцветок он обрезан.
        'comp': max(comps, key=len) if comps else None,
        'g': next(iter(gs), None), 'm': next(iter(ms), None),
        'needle': None, 'gauge': None,
        'src': 'pryazha.online (карточки, марка ArtLand)', 'url': None,
    })

print(f"коллекций {len(groups)}, к заливке {len(rows)}, карточек не открылось {failed}")
for r in rows:
    per = round(r['m'] * 100 / r['g']) if r['m'] and r['g'] else None
    print(f"   {r['line'][:28]:30} {r['g']}г/{r['m']}м = {per} м/100г   {(r['comp'] or '—')[:44]}")

data = json.load(open(OUT, encoding='utf-8'))
before = len(data['items'])
have = {(i['brand'], i['line'], i['src']) for i in data['items']}
added = [r for r in rows if (r['brand'], r['line'], r['src']) not in have]
data['items'].extend(added)
notes = data.get('_source_notes')
if isinstance(notes, list):
    notes.append('pryazha.online — марка ArtLand: 376 расцветок схлопнуты по полю «Коллекция» с карточек')
json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"добавлено {len(added)}, web_specs {before} -> {len(data['items'])}")
