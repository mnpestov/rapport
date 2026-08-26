# -*- coding: utf-8 -*-
"""Сбор ссылок на товары pryaja.ru по брендам из каталога пряжи."""
import json, os, re, sys, time
import requests
from bs4 import BeautifulSoup

H = {'User-Agent': 'Mozilla/5.0'}
BASE = 'https://pryaja.ru/'
# Кэш страниц и промежуточные файлы — рядом со скриптом, но в репозиторий
# не едут: это сотни html-страниц чужого магазина.
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pryaja')
os.makedirs(HERE, exist_ok=True)

BRANDS = {
    'DROPS_(norvegiya)-3': 'DROPS', 'SANDNESGARN-572': 'Sandnes Garn',
    'infinity_norvegiyaperues-3264': 'Infinity Design', 'ORION': 'Orion',
    'dale_garn_norvegiya-1504': 'Dale Garn', 'du_store_alpakka_norvegiya-143': 'Du Store Alpakka',
    'malabrigo_urugvay-3261': 'Malabrigo', 'bc_garn_daniya-1128': 'BC Garn',
    'BERGERE_DE_FRANCE_(frantsiya)-78': 'Bergere de France', 'anny_blatt_frantsiya-1320': 'Anny Blatt',
    'lantern_moon_ssha-2024': 'Lantern Moon', 'performance_bolgariya-3047': 'Performance',
    'SEAM-74': 'Seam', 'ALIZE_(turtsiya)-24': 'Alize', 'YARNART-47': 'YarnArt',
    'CHEVAL_BLANC-142': 'Cheval Blanc', 'KATIA-140': 'Katia',
}

def get(url, path):
    if os.path.exists(path):
        return open(path, encoding='utf-8').read()
    r = requests.get(url, headers=H, timeout=30)
    r.raise_for_status()
    open(path, 'w', encoding='utf-8').write(r.text)
    time.sleep(0.4)                              # магазин чужой, не долбим
    return r.text

os.makedirs(os.path.join(HERE, 'cache'), exist_ok=True)
out = {}
for slug, brand in BRANDS.items():
    page, seen = 1, {}
    while True:
        url = f"{BASE}catalog/{slug}/" + (f"?page={page}" if page > 1 else "")
        fn = os.path.join(HERE, 'cache', re.sub(r'[^\w]+', '_', f"{slug}_{page}") + '.html')
        try:
            html = get(url, fn)
        except Exception as e:
            print(f"  {brand} стр.{page}: {e}"); break
        s = BeautifulSoup(html, 'html.parser')
        found = {}
        for a in s.find_all('a', href=True):
            h = a['href']
            if '/product/' not in h:
                continue
            t = a.get_text(' ', strip=True)
            if t and t.lower().startswith('пряжа'):
                found[h.replace('./', BASE)] = t
        new = {k: v for k, v in found.items() if k not in seen}
        seen.update(found)
        if not new or page > 12:
            break
        page += 1
    out[brand] = seen
    print(f"{brand:20} {len(seen):4} товаров")

json.dump(out, open(os.path.join(HERE, 'links.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print("итого:", sum(len(v) for v in out.values()))
