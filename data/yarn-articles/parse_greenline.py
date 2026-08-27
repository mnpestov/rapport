# -*- coding: utf-8 -*-
"""greenline24.com, раздел «Пряжа на бобинах» -> greenline_products.json + web_specs.json.

Магазин продаёт бобинный сток: каждая РАСЦВЕТКА — отдельный товар со своей
ценой и остатком в граммах. Артикул пряжи в нашем понимании — это пара
«Производитель + Коллекция», и одна такая пара даёт от одного до полусотни
товаров. Поэтому скрипт делает два разных файла: `greenline_products.json` —
товары как есть (для истории цен и остатков), `web_specs.json` — схлопнутые
по паре карточки пряжи.

Три места, где наивный разбор врёт, и что с ними сделано.

**1. Листинг по умолчанию теряет товары.** Сортировка `newest` неустойчива:
у товаров, заведённых одной пачкой, совпадает время, и порядок между
запросами страниц плывёт. Обход 29 страниц дал 653 уникальных URL из 688
заявленных — 35 позиций показались дважды на соседних страницах, столько же
не показалось ни разу. Поэтому ходим с `sort=name` (даёт ровно 688) и
СВЕРЯЕМ число с тем, что магазин пишет сам («Найдено: N товаров»); при
недоборе доливаем из других сортировок, а не молча продолжаем.

**2. Заголовок товара неоднозначен.** Он склеен из тех полей, что заполнены:
`[Производитель, ][Коллекция, ]Состав, Цвет`. У 73 позиций одно из первых
двух полей пустое, и по одной запятой не понять, что именно: «Botto Poala,
Альпака 20% Меринос 80%, …» — это производитель без коллекции, а «Pompei,
Полиамид 100%, …» — коллекция без производителя. Различает их только блок
«Характеристики» на карточке, поэтому обходим все 688 карточек, а не
довольствуемся листингом.

**3. Метраж внутри одной коллекции расходится** — у 18 групп из 195. Но
расходится он не пополам: у «Supergeelong» 21 расцветка из 22 идёт по
1500 м/100 г и одна по 750, у «Igea Astro 50» — 11 из 12. Обнулять метраж
из-за одной выбивающейся карточки значит выбрасывать данные, которые магазин
подтвердил десять раз. Поэтому берём значение двух третей группы и выше, а
при разнобое (1:1, 4:3) не выбираем вовсе — оставляем пусто и печатаем
группу: пустое поле сборщик добёрет из другого источника, неверное нет.
Так пустыми остаются 5 групп.

Имя есть только там, где известен ПРОИЗВОДИТЕЛЬ. Коллекции может не быть —
тогда линейкой становится состав («Botto Poala, Альпака 20% Меринос 80%» так
и продаётся); а вот одна «Seta» или «Pompei» без марки — слово, которое в
описаниях значит что угодно, и связывать по нему нельзя. Такие позиции
остаются в файле товаров и в справочник не идут. Туда же уходит «Италия» в
поле «Производитель»: это страна, а не марка.
"""
import collections, json, os, re, sys, time
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, 'greenline')
OUT = os.path.join(HERE, 'web_specs.json')
PRODUCTS = os.path.join(HERE, 'greenline_products.json')
BASE = 'https://greenline24.com'
CATALOG = '/catalog/bobiny-stok'
SRC = 'greenline24.com (бобинная пряжа)'
H = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                   'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'}
PAUSE = 0.35

# Написание марки у магазина своё: «ZEGNA BARUFFA LANE BORGOSESIA» — это
# та же Zegna Baruffa, что уже лежит в справочнике под коротким именем.
# Словарь марок из yarn_lib — общий с разбором описаний, поэтому марка,
# известная ему, приводится к каноническому написанию; незнакомую оставляем
# как на сайте.
sys.path.insert(0, os.path.join(ROOT, 'apps', 'backend', 'src', 'scripts'))
from yarn_lib.brands import ALIAS_RE, ALIAS_TO_BRAND


def canon_brand(raw):
    if not raw:
        return None
    name = re.sub(r'\s+', ' ', raw).strip(' ,')
    m = ALIAS_RE.search(name)
    return ALIAS_TO_BRAND[m.group(1).lower()] if m else name


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return open(path, encoding='utf-8').read()
    r = requests.get(urljoin(BASE, url), headers=H, timeout=30)
    r.raise_for_status()
    open(path, 'w', encoding='utf-8').write(r.text)
    time.sleep(PAUSE)
    return r.text


def listing(sort, pages):
    """URL товаров с одной сортировки. Возвращает (url -> заголовок, всего)."""
    out, total = {}, None
    for p in range(1, pages + 1):
        html = fetch(f'{CATALOG}?page={p}&sort={sort}',
                     os.path.join(CACHE, f'list_{sort}_{p}.html'))
        soup = BeautifulSoup(html, 'html.parser')
        if total is None:
            m = re.search(r'Найдено:\s*(\d+)', soup.get_text(' ', strip=True))
            total = int(m.group(1)) if m else None
        for card in soup.select('article.product-preview'):
            a = card.select('a[href*="/product/"]')[-1]
            out[a['href']] = a.get('title')
    return out, total


def page_count():
    html = fetch(f'{CATALOG}?page=1&sort=name', os.path.join(CACHE, 'list_name_1.html'))
    txt = BeautifulSoup(html, 'html.parser').get_text(' ', strip=True)
    m = re.search(r'Страница\s+\d+\s+из\s+(\d+)', txt)
    return int(m.group(1)) if m else 1


# ── карточка товара ───────────────────────────────────────────────────────
MET = re.compile(r'(\d+)\s*м\s*/\s*(\d+)\s*гр?', re.I)
COLOR = re.compile(r'^(.*?)\s*\(([^()]*)\)\s*$')


def read_card(html):
    soup = BeautifulSoup(html, 'html.parser')
    spec = {}
    head = next((h for h in soup.find_all('h2')
                 if h.get_text(strip=True) == 'Характеристики'), None)
    if head:
        for row in (head.find_parent('section') or soup).select('div.divide-y > div'):
            cells = row.find_all('div', recursive=False)
            if len(cells) < 2:
                continue
            label = cells[0].get_text(' ', strip=True)
            links = [a.get_text(' ', strip=True) for a in cells[1].select('a')]
            spec[label] = links or [cells[1].get_text(' ', strip=True)]

    ld = {}
    for tag in soup.find_all('script', type='application/ld+json'):
        if tag.string and '"Product"' in tag.string:
            try:
                ld = json.loads(tag.string)
            except ValueError:
                ld = {}
            break

    text = soup.get_text('\n', strip=True)
    # «Артикул 18762» стоит одной строкой, а не подписью над значением, как
    # остальные поля карточки: \s+ покрывает оба варианта вёрстки.
    sku = re.search(r'Артикул\s+(\S+)', text)
    stock = re.search(r'В наличии:\s*\n?\s*([\d\s]+)\s*г\.', text)

    m = MET.search(' '.join(spec.get('Метраж', [])))
    color = ' '.join(spec.get('Цвет', [])) or None
    cm = COLOR.match(color) if color else None

    offer = (ld.get('offers') or {}) if isinstance(ld, dict) else {}
    return {
        # Номер, который магазин показывает человеку, и внутренний id из
        # микроразметки — разные вещи; нужны оба: по первому ищут в магазине,
        # по второму сходятся карточки при следующем обходе.
        'sku': sku.group(1) if sku else None,
        'shop_id': ld.get('sku') if isinstance(ld, dict) else None,
        'title': ld.get('name'),
        'brand': canon_brand(' '.join(spec.get('Производитель', []))) or None,
        'brand_raw': ' '.join(spec.get('Производитель', [])) or None,
        'line': ' '.join(spec.get('Коллекция', [])) or None,
        'composition': ' '.join(spec.get('Детальный состав', [])) or None,
        'kind': spec.get('Вид пряжи') or None,
        'base_color': ' '.join(spec.get('Базовый цвет', [])) or None,
        'color': cm.group(1).strip() if cm else color,
        'color_code': cm.group(2).strip() if cm else None,
        'm': int(m.group(1)) if m else None,
        'g': int(m.group(2)) if m else None,
        'price_rub_per_100g': float(offer['price']) if offer.get('price') else None,
        'in_stock_g': int(re.sub(r'\s', '', stock.group(1))) if stock else None,
        'available': (offer.get('availability') or '').endswith('InStock'),
        'category': ld.get('category'),
        'image': (ld.get('image') or [None])[0] if isinstance(ld.get('image'), list) else ld.get('image'),
    }


# ── обход ─────────────────────────────────────────────────────────────────
os.makedirs(CACHE, exist_ok=True)
pages = page_count()
found, total = listing('name', pages)
print(f"страниц {pages}, заявлено товаров {total}, собрано URL {len(found)}")

# Недобор означает, что и эта сортировка поехала: доливаем из запасных, а не
# делаем вид, что каталог кончился.
for spare in ('newest', 'weight_asc'):
    if total and len(found) >= total:
        break
    extra, _ = listing(spare, pages)
    new = {u: t for u, t in extra.items() if u not in found}
    found.update(new)
    print(f"  добор из sort={spare}: +{len(new)} -> {len(found)}")
if total and len(found) != total:
    print(f"ВНИМАНИЕ: собрано {len(found)}, магазин заявляет {total}")

products, failed = [], []
for i, (url, title) in enumerate(sorted(found.items()), 1):
    path = os.path.join(CACHE, url.rstrip('/').split('/')[-1] + '.html')
    try:
        card = read_card(fetch(url, path))
    except Exception as exc:
        failed.append((url, repr(exc)))
        continue
    card['url'] = urljoin(BASE, url)
    card['listing_title'] = title
    products.append(card)
    if i % 100 == 0:
        print(f"  карточек {i}/{len(found)}")

print(f"разобрано товаров {len(products)}, не открылось {len(failed)}")
for u, e in failed[:10]:
    print("   !", u, e)

json.dump({
    'source': SRC,
    'catalog_url': urljoin(BASE, CATALOG),
    'declared_total': total,
    'items': sorted(products, key=lambda p: (p['brand'] or '', p['line'] or '', p['color'] or '')),
}, open(PRODUCTS, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"товары -> {os.path.relpath(PRODUCTS, ROOT)}")

# ── схлопывание расцветок в артикулы ──────────────────────────────────────
# Группируем НЕ по паре строк, а по тому же ключу, которым потом
# дедуплицирует build_reference: у магазина одна и та же пряжа записана
# по-разному («Todd&Duncan Cashmere 100» и «Todd&Duncan Cashmere 100%»,
# «New Mill» и «NEW MILL»). Сгруппируй по строкам — и две записи доедут до
# сборщика, где он молча сольёт их в одну, взяв метраж первой попавшейся:
# 1400 у одной против 700 у другой. Ключ считаем здесь, чтобы расхождение
# всплыло тут же и в отчёте.
HOMO = str.maketrans('аеосхурмвнткАЕОСХУРМВНТК', 'aeocxypmbhtkAEOCXYPMBHTK')


def refkey(s):
    import unicodedata
    s = unicodedata.normalize('NFKC', s or '').translate(HOMO).lower()
    return re.sub(r'[^a-zа-яё0-9]', '', s)


def top(values):
    """Самое частое написание; при равенстве — первое по алфавиту."""
    c = collections.Counter(v for v in values if v)
    return sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if c else None


# Доля, при которой значение считается значением всей группы. Две трети —
# граница, отделяющая «одна карточка выбивается» (21:1, 11:1, 24:3) от
# «под одним именем лежат две разные пряжи» (2:2, 4:3, 3:2). Ниже неё не
# выбираем вовсе: усреднение и «победило большинство в один голос» одинаково
# сочиняют число, которого у половины расцветок нет.
MAJORITY = 2 / 3


def dominant(values):
    """(значение группы, разбивка если единого значения нет)."""
    c = collections.Counter(v for v in values if v is not None)
    if not c:
        return None, None
    value, hits = c.most_common(1)[0]
    if len(c) == 1 or hits / sum(c.values()) >= MAJORITY:
        return value, None
    return None, dict(c.most_common())


# «Италия» в поле «Производитель» — не марка, а страна: под ней у магазина
# лежат две позиции разных фабрик. Имени пряжи из неё не выйдет.
NOT_A_BRAND = {'италия', 'китай', 'турция'}

groups = collections.defaultdict(list)
nameless, countries = [], []
for p in products:
    brand = None if (p['brand'] or '').lower() in NOT_A_BRAND else p['brand']
    if brand != p['brand']:
        countries.append(p)
    # Коллекции нет — линейкой становится состав: «Botto Poala, Альпака 20%
    # Меринос 80%» так и продаётся, другого имени у неё нет. А вот без
    # ПРОИЗВОДИТЕЛЯ имени не получается вовсе: «Seta», «Pompei» — одно слово,
    # которое в описаниях значит что угодно, и связывать по нему нельзя.
    line = p['line'] or p['composition']
    if not brand or not line:
        nameless.append(p)
        continue
    groups[refkey(f"{brand} {line}")].append((brand, line, p))

rows, conflicts = [], []
for k, items in sorted(groups.items()):
    brand = top([b for b, _, _ in items])
    line = top([l for _, l, _ in items])
    cards = [p for _, _, p in items]
    comps = {p['composition'] for p in cards if p['composition']}
    m, m_split = dominant(p['m'] for p in cards)
    g, g_split = dominant(p['g'] for p in cards)
    if m_split or g_split:
        conflicts.append((brand, line, m_split or g_split, m if not m_split else None,
                          len(cards)))
    rows.append({
        'brand': brand,
        'line': line,
        'comp': max(comps, key=len) if comps else None,
        'g': g,
        'm': m,
        'needle': None, 'gauge': None,
        'src': SRC,
        # Ссылка ведёт на конкретную расцветку — другой у магазина нет.
        'url': min(cards, key=lambda p: p['url'])['url'],
    })

print(f"\nартикулов {len(rows)}; товаров без имени {len(nameless)} "
      f"(из них с «страной» вместо марки {len(countries)}); "
      f"метраж без единого значения у {len(conflicts)}")
for b, l, split, taken, n in conflicts:
    print(f"  РАЗНОБОЙ «{b} / {l}» ({n} расцветок): {split} — метраж не заводим")
print("  без имени (в справочник не идут, остаются в файле товаров):")
for p in sorted(nameless, key=lambda p: (p['brand'] or '', p['line'] or '', p['composition'] or '')):
    print(f"    {(p['brand'] or '—'):16} / {(p['line'] or '—'):14} / {p['composition'][:38]}")

data = json.load(open(OUT, encoding='utf-8'))
before = len(data['items'])
# Сверка с уже собранным — по тому же ключу, а не по паре строк: иначе
# «New Mill / Super soft» ляжет вторым экземпляром рядом с «NEW MILL /
# Super soft», собранным прошлым проходом.
have = {refkey(f"{i['brand']} {i['line']}") for i in data['items'] if 'greenline24' in i['src']}
added = [r for r in rows if refkey(f"{r['brand']} {r['line']}") not in have]
# Ссылки у ранее собранных позиций ведут на старую схему URL магазина
# (/product/<длинный-слаг-с-датой>). Мёртвыми они не стали — магазин отдаёт
# 301 на /product/<слаг>/<uuid>, — но лишний редирект и дата в адресе нам ни
# к чему, поэтому переписываем на тот адрес, который каталог отдаёт сейчас.
# Сверяемся со ВСЕМИ источниками этого магазина, а не только с основным:
# одна карточка (Lanecardate Canberra) заведена прошлым проходом как
# «карточка проданного товара», и по строгому сравнению она получила бы
# второй экземпляр рядом с собой.
fresh = {refkey(f"{r['brand']} {r['line']}"): r for r in rows}
refreshed = gone = 0
fixed = []
for item in data['items']:
    if 'greenline24' not in item['src']:
        continue
    r = fresh.get(refkey(f"{item['brand']} {item['line']}"))
    if not r:
        gone += 1                       # распродано: карточку оставляем, ссылку тоже
        continue
    if item.get('url') != r['url']:
        item['url'] = r['url']
        refreshed += 1
    # Прошлый проход снимал характеристики с части расцветок и мог взять
    # выбивающуюся: у «Lanerossi FOLCO» так записано 1250 при 1400 у шести
    # карточек из восьми. Полный обход каталога — выборка лучше, поэтому
    # перебиваем. Пустым (разнобой) не перебиваем: старое значение хуже не
    # стало от того, что мы не смогли выбрать.
    for field in ('m', 'g', 'comp'):
        if r[field] is not None and item.get(field) != r[field]:
            fixed.append(f"{item['brand']} / {item['line']}: "
                         f"{field} {item.get(field)!r} -> {r[field]!r}")
            item[field] = r[field]
data['items'].extend(added)
notes = data.get('_source_notes')
if isinstance(notes, list):
    note = ('greenline24.com — раздел «Пряжа на бобинах» целиком: листинг с sort=name '
            '(сортировка по умолчанию теряет позиции), характеристики с карточек товара')
    if note not in notes:
        notes.append(note)
json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"\nдобавлено {len(added)}, ссылок обновлено {refreshed}, "
      f"характеристик исправлено {len(fixed)}, нет в текущем стоке {gone}, "
      f"web_specs {before} -> {len(data['items'])}")
for f in fixed:
    print("   правка:", f)
