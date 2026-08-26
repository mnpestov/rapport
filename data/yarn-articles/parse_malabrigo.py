# -*- coding: utf-8 -*-
"""Malabrigo -> web_specs.json.

Страница malabrigoyarn.com/yarns — SPA: в разметке видна карточка только
одной пряжи, зато в window.__PRELOADED_STATE__ лежит выгрузка CMS со всеми
27, с метражом, весом мотка, плотностью, спицами и составом.
"""
import json, os, re, sys

# Сохранённая страница malabrigoyarn.com/yarns. Путь задаётся аргументом,
# иначе скрипт привязан к одному чужому рабочему столу.
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'malabrigo - Yarns.html')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web_specs.json')

h = open(SRC, encoding='utf-8', errors='ignore').read()
i = h.find('window.__PRELOADED_STATE__')
start = h.index('({', i) + 1
d = 0
for j in range(start, len(h)):
    if h[j] == '{': d += 1
    elif h[j] == '}':
        d -= 1
        if d == 0:
            end = j + 1
            break
state = json.loads(h[start:end])


def walk(o):
    if isinstance(o, dict):
        if 'yardage_meters' in o:
            yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)


def txt(f):
    if isinstance(f, list):
        s = ' '.join((x.get('text') or '') for x in f if isinstance(x, dict)).strip()
        return s or None
    return f or None


def needles_mm(s):
    """«US 13 - 19 or 9 - 15mm» -> «9—15 мм».

    Берём именно миллиметры: наш parse_needles вытаскивает из строки все
    числа и берёт крайние, и на «US 13 - 19 or 9 - 15mm» получил бы 9 и 19 —
    смесь американского номера с миллиметром.
    """
    if not s:
        return None
    m = re.findall(r'([\d.,]+)\s*(?:[-–]\s*([\d.,]+)\s*)?mm', s, re.I)
    if not m:
        return None
    a, b = m[-1]
    return f"{a}—{b} мм" if b else f"{a} мм"


def gauge_ru(s):
    """«8.0 to 10.0 sts = 4 inches» -> «8—10 п.» (4 дюйма это наши 10 см)."""
    if not s:
        return None
    m = re.search(r'([\d.]+)\s*(?:to|[-–])\s*([\d.]+)\s*sts', s, re.I)
    if m:
        return f"{int(float(m.group(1)))}—{int(float(m.group(2)))} п."
    m = re.search(r'([\d.]+)\s*sts', s, re.I)
    return f"{int(float(m.group(1)))} п." if m else None


rows = []
for doc in walk(state):
    name = txt(doc.get('yarn_title'))
    if not name:
        continue
    ym = txt(doc.get('yardage_meters')) or ''
    sw = txt(doc.get('skein_weight')) or ''
    mm = re.search(r'\(([\d.]+)\s*meters?\)', ym) or re.search(r'([\d.]+)\s*meters?', ym)
    gg = re.search(r'([\d.]+)\s*(?:grams?|grs|g)\b', sw, re.I)
    m = round(float(mm.group(1))) if mm else None
    g = round(float(gg.group(1))) if gg else None

    # Nube и Cloud — ровница для прядения, а не пряжа: в CMS у них
    # yarn_weight = Roving, texture = Spinning fiber, а «5 ярдов на 113 г»
    # описывает образец, а не моток. Метраж пришлось бы записать как
    # 4 м/100 г, и он сбивал бы сопоставление. Карточки оставляем — товар
    # настоящий, — но без метража.
    if (txt(doc.get('yarn_weight')) or '').lower() == 'roving':
        m = g = None

    rows.append({
        'brand': 'Malabrigo',
        'line': name,
        'comp': txt(doc.get('content')),
        'g': g,
        'm': m,
        'needle': needles_mm(txt(doc.get('needle_size'))),
        'gauge': gauge_ru(txt(doc.get('gauge'))),
        'src': 'malabrigoyarn.com (производитель)',
        'url': 'https://malabrigoyarn.com/yarns/' + re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'),
    })

data = json.load(open(OUT, encoding='utf-8'))
before = len(data['items'])
# Дублей по (бренд, линейка) не боимся: сборщик кладёт записи через put(),
# который при равном ключе берёт поля от источника с более высоким рангом.
# У производителя ранг 3, у магазина 2 — значит его метраж, спицы и
# плотность вытеснят магазинные, а не наоборот. Пропускать такие строки
# было бы ошибкой: девять линеек Malabrigo лежат тут с pryazha.su, где нет
# ни спиц, ни плотности.
have = {(i['brand'], i['line'], i['src']) for i in data['items']}
added = [r for r in rows if (r['brand'], r['line'], r['src']) not in have]
data['items'].extend(added)
notes = data.get('_source_notes')
if isinstance(notes, list):
    notes.append('malabrigoyarn.com — выгрузка CMS из window.__PRELOADED_STATE__ сохранённой страницы /yarns, 27 позиций')
json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"разобрано {len(rows)}, добавлено {len(added)}, было {before} -> стало {len(data['items'])}")
for r in added:
    per = round(r['m'] * 100 / r['g']) if r['m'] and r['g'] else None
    print(f"  {r['line']:20} {str(per) + ' м/100г' if per else 'метраж не указан':>16}  {r['needle'] or '-':>14}  {(r['comp'] or '')[:38]}")
