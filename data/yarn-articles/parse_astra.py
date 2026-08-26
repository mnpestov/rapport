# -*- coding: utf-8 -*-
"""astra-premium.ru -> web_specs.json.

Сохранённая страница каталога. Всё нужное лежит в заголовке карточки, но
в двух разных видах — старые позиции разбиты на три строки, новые записаны
одной:

    Пряжа "Афродита" / 50% шерсть, 50% акрил / 100гр. / 250м
    Пряжа Astra Premium 'Ласка' 100гр 370м (70% полиэстер, 20% акрил, ...)

Поэтому строки склеиваются, а дальше разбираются по признакам: имя в
кавычках, вес с метражом по единицам измерения, состав по процентам.
Английское имя в скобках («(Jeans Light)») составом не является — от
состава оно отличается отсутствием процента.
"""
import json, os, re, sys

from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(HERE)), 'Купить пряжу - Астра Премиум.html')
OUT = os.path.join(HERE, 'web_specs.json')

NAME = re.compile(r'["\'«“”‘’]\s*([^"\'«»“”‘’]{2,48}?)\s*["\'»“”‘’]')
GM = re.compile(r'(\d+)\s*гр?\.?\s*[/\s]\s*(\d+)\s*м\b', re.I)
# Состав собираем из пар «доля — волокно», а не выдираем скобку целиком.
# Скобка врёт двумя способами сразу: у пяти позиций в ней стоит допуск
# «(+/- 5%)» вместо состава, а у четырёх — английское имя, которое затекает
# в начало («(Jeans) 48% хлопок», «носочная (Karelia sock) 75% шерсть»).
# Пара же однозначна: после доли обязано идти слово о волокне, и «+/- 5%»
# под это не подходит — за ним ничего нет.
# Цифры в названии волокна запрещены: без этого хвост состава дотягивался
# до веса и метража — «100% акрил 100гр. / 250м».
COMP_PART = re.compile(r'(\d{1,3})\s*%\s*([А-Яа-яЁёA-Za-z][^,;()%\d]{1,30})')

soup = BeautifulSoup(open(SRC, encoding='utf-8', errors='ignore').read(), 'html.parser')
rows, skipped = [], []
seen = set()
for item in soup.select('.item'):
    node = item.select_one('[itemprop="name"]')
    link = item.select_one('a[itemprop="url"]')
    if not node:
        continue
    text = ' '.join(x.strip() for x in node.get_text('\n').split('\n') if x.strip())
    nm = NAME.search(text)
    gm = GM.search(text)
    if not nm or not gm:
        skipped.append(text)
        continue
    name = nm.group(1).strip()
    g, m = int(gm.group(1)), int(gm.group(2))

    parts = [f"{p}% {w.strip(' .')}" for p, w in COMP_PART.findall(text) if w.strip(' .')]
    comp = ', '.join(parts) or None

    key = name.lower()
    if key in seen:
        continue
    seen.add(key)
    rows.append({
        'brand': 'Astra Premium', 'line': name, 'comp': comp or None,
        'g': g, 'm': m, 'needle': None, 'gauge': None,
        'src': 'astra-premium.ru (справочник производителя)',
        'url': link['href'] if link else None,
    })

print(f"разобрано {len(rows)}, пропущено {len(skipped)}")
for t in skipped:
    print("   ?", t[:90])

data = json.load(open(OUT, encoding='utf-8'))
before = len(data['items'])
have = {(i['brand'], i['line'], i['src']) for i in data['items']}
added = [r for r in rows if (r['brand'], r['line'], r['src']) not in have]
data['items'].extend(added)
notes = data.get('_source_notes')
if isinstance(notes, list):
    notes.append('astra-premium.ru — сохранённая страница каталога, разбор заголовков карточек')
json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"добавлено {len(added)}, web_specs {before} -> {len(data['items'])}")
