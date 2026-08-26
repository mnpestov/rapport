# -*- coding: utf-8 -*-
"""Справочник производителя Камтекс -> web_specs.json.

ГЛАВНОЕ ПРО ИСХОДНИК: поле называется `length_per_100g_meters`, но в нём
лежит МЕТРАЖ МОТКА, а не метраж на 100 г. Проверено сверкой двенадцати
позиций с независимым разбором kudel.ru: Денди 50 г / 330 м, Аргентинская
шерсть 100 г / 200 м, Мотылёк 50 г / 140 м, Лотос Травка Стрейч 50 г / 80 м —
совпадает всё до цифры. Буквальное прочтение имени поля вдвое занизило бы
метраж у каждой пятидесятиграммовой пряжи: Денди стал бы 330 м/100 г вместо
660.

Ровно на этом уже обожглись со справочником hollywool.ru, где то же имя
поля означало то же самое — метраж мотка (см. комментарий в
build_reference.py). Совпадение не случайное: так пишут выгрузки, где вес
мотка лежит отдельным полем.

Категория «Валяние» — кардочес и лента для валяния, у них метража нет и не
может быть. Карточки заводим (товар настоящий), метраж пустой.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'kamteks_source.json')
OUT = os.path.join(HERE, 'web_specs.json')

src = json.load(open(SRC, encoding='utf-8'))
rows = []
for cat in src['categories']:
    for it in cat['items']:
        g = it.get('skein_weight_grams')
        m = it.get('length_per_100g_meters')     # на самом деле метраж мотка
        rows.append({
            'brand': 'Камтекс',
            'line': it['name'],
            'comp': it.get('composition'),
            'g': g,
            'm': m,
            'needle': None,                      # в выгрузке нет
            'gauge': None,
            'src': 'kamtex.ru (справочник производителя)',
            'url': None,
        })

data = json.load(open(OUT, encoding='utf-8'))
before = len(data['items'])
seen = {(i['brand'], i['line'], i['src']) for i in data['items']}
added = [r for r in rows if (r['brand'], r['line'], r['src']) not in seen]
data['items'].extend(added)
notes = data.get('_source_notes')
if isinstance(notes, list):
    notes.append('kamtex.ru — справочник производителя, 57 позиций; поле '
                 'length_per_100g_meters в исходнике содержит метраж МОТКА')
json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"разобрано {len(rows)}, добавлено {len(added)}, web_specs {before} -> {len(data['items'])}")
