# -*- coding: utf-8 -*-
"""rows.json -> web_specs.json (вход сборщика справочника)."""
import json, os, re, sys

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pryaja')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web_specs.json')

# Магазин пишет названия капсом. В справочнике они в обычном регистре, и
# ключ сравнения регистр игнорирует — но `name` попадает в каталог как есть,
# и «DROPS ALASKA» рядом с «Drops Air» выглядело бы поломкой.
def titlecase(s):
    return re.sub(r'[A-Za-zА-Яа-яЁё]+',
                  lambda m: m.group(0).capitalize() if m.group(0).isupper() else m.group(0), s)

# «Uni Colour» и «Mix» у Drops — обозначение окраса (однотонная и меланжевая
# крутка одной и той же пряжи), а не разные линейки. Проверено: во всех
# одиннадцати парах метраж совпадает до метра, а авторы пишут просто «Drops
# Alpaca». Оставить суффикс значило бы завести две карточки на одну пряжу и
# ни одной с тем именем, которым её называют.
COLOURWAY = re.compile(r'\s+(uni\s*colou?r|mix)$', re.I)

rows = json.load(open(os.path.join(HERE, 'rows.json'), encoding='utf-8'))
data = json.load(open(OUT, encoding='utf-8'))
before = len(data['items'])
seen = {(i['brand'], i['line'], i['src']) for i in data['items']}

added = 0
for r in rows:
    line = titlecase(r['line'])
    if r['brand'] == 'Drops':
        line = COLOURWAY.sub('', line).strip()
    item = dict(r, line=line)
    if (item['brand'], item['line'], item['src']) in seen:
        continue
    seen.add((item['brand'], item['line'], item['src']))
    data['items'].append(item)
    added += 1

notes = data.get('_source_notes')
if isinstance(notes, list):
    notes.append('pryaja.ru — разбор 17 брендов каталога пряжи, 250 карточек; '
                 'состав/вес/метраж из названия товара, спицы и плотность с карточки')
json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"добавлено {added}, web_specs {before} -> {len(data['items'])}")
