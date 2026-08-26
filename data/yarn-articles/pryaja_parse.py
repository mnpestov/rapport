# -*- coding: utf-8 -*-
"""pryaja.ru -> web_specs.json.

Название товара несёт состав, вес и метраж целиком:
«Пряжа DROPS ALASKA (100% шерсть 50г 70м)». Спицы и плотность лежат уже
на карточке: «Рекомендованный размер спиц: 5мм. Плотность вязания:
10см х 10см = 17п х 22р.»
"""
import json, os, re, sys, time
import requests
from bs4 import BeautifulSoup

# Кэш страниц и промежуточные файлы — рядом со скриптом, но в репозиторий
# не едут: это сотни html-страниц чужого магазина.
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pryaja')
os.makedirs(HERE, exist_ok=True)
H = {'User-Agent': 'Mozilla/5.0'}
links = json.load(open(os.path.join(HERE, 'links.json'), encoding='utf-8'))
os.makedirs(os.path.join(HERE, 'prod'), exist_ok=True)

# Магазин пишет марку капсом; в справочнике она уже есть в своём написании,
# и разойтись им нельзя — иначе получится второй бренд-двойник.
BRAND_FIX = {'DROPS': 'Drops'}

TITLE = re.compile(r'^Пряжа\s+(.+?)\s*\((.*)\)\s*$', re.S)
GM = re.compile(r'(\d+)\s*(?:г|гр)\b[\s,]*(\d+)\s*м\b')
MG = re.compile(r'(\d+)\s*м\b[\s,]*(\d+)\s*(?:г|гр)\b')
NEEDLE = re.compile(r'разм[а-я]*\s*спиц[^:]*:\s*([\d.,]+(?:\s*[-–]\s*[\d.,]+)?)\s*мм', re.I)
GAUGE = re.compile(r'(\d+)\s*п[\s.]*[хx*]\s*(\d+)\s*р', re.I)


def fetch(url, path):
    if os.path.exists(path):
        return open(path, encoding='utf-8').read()
    r = requests.get(url, headers=H, timeout=30)
    r.raise_for_status()
    open(path, 'w', encoding='utf-8').write(r.text)
    time.sleep(0.35)
    return r.text


rows, skipped = [], []
for brand, items in links.items():
    brand = BRAND_FIX.get(brand, brand)
    for url, title in items.items():
        m = TITLE.match(title)
        if not m:
            skipped.append(title)
            continue
        name, inside = m.group(1).strip(), m.group(2)
        # Марка в начале названия — убираем, сборщик склеит «бренд + линейка»
        # сам, иначе выйдет «Drops Drops Alaska».
        line = re.sub(r'^' + re.escape(brand) + r'\s+', '', name, flags=re.I).strip()
        g = mm = None
        gm = GM.search(inside) or None
        if gm:
            g, mm = int(gm.group(1)), int(gm.group(2))
        else:
            mg = MG.search(inside)
            if mg:
                mm, g = int(mg.group(1)), int(mg.group(2))
        # Состав — всё до веса/метража.
        comp = inside
        cut = min([x.start() for x in (GM.search(inside), MG.search(inside)) if x] or [len(inside)])
        comp = inside[:cut].strip(' ,;')

        fn = os.path.join(HERE, 'prod', re.sub(r'[^\w]+', '_', url.split('/product/')[-1])[:90] + '.html')
        try:
            page = fetch(url, fn)
        except Exception as e:
            page = ''
        text = re.sub(r'\s+', ' ', BeautifulSoup(page, 'html.parser').get_text(' ', strip=True)) if page else ''
        nm = NEEDLE.search(text)
        gg = GAUGE.search(text)
        rows.append({
            'brand': brand, 'line': line,
            'comp': comp or None, 'g': g, 'm': mm,
            'needle': (nm.group(1).replace(',', '.') + ' мм') if nm else None,
            'gauge': (f"{gg.group(1)} п. x {gg.group(2)} р.") if gg else None,
            'src': 'pryaja.ru (разбор карточек)', 'url': url,
        })

print(f"разобрано {len(rows)}, пропущено {len(skipped)}")
for t in skipped[:8]:
    print("   ?", t[:80])
json.dump(rows, open(os.path.join(HERE, 'rows.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
