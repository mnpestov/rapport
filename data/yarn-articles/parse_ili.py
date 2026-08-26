# -*- coding: utf-8 -*-
"""ili-ili.com -> web_specs.json.

Характеристики берутся из двух мест карточки, и второе легко пропустить.

В JSON-LD лежат состав, вес мотка, метраж и один размер спиц. А блок
«Детали» под ним даёт диапазон спиц и ПЛОТНОСТЬ — но опознать его строки
можно только по имени файла иконки: слов «плотность» и «спицы» в разметке
нет вовсе, поэтому поиск по ключевым словам этот блок не находит, и на
первом заходе я решил, что плотности сайт не публикует. Она есть у 282
карточек из 414.

Две ловушки листинга:
  • вес мотка приходит в КИЛОГРАММАХ («0.1» = 100 г);
  • за пределом диапазона страниц сайт отдаёт СОДЕРЖИМОЕ ПЕРВОЙ страницы,
    а не пустоту, поэтому обход «пока не пусто» зацикливается. Страниц
    ровно 18, это проверено сравнением с первой.
"""
import collections, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'web_specs.json')
ROWS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'ili', 'rows.json')

# Магазин пишет марку капсом и со страной: «KATIA (Испания)». В справочнике
# она в своём написании, и разойтись им нельзя — иначе выйдет бренд-двойник.
BRAND = {
    'lana grossa': 'Lana Grossa', 'katia': 'Katia', 'lang yarns': 'Lang Yarns',
    'schoppel': 'Schoppel', 'rowan': 'Rowan', 'schachenmayr': 'Schachenmayr',
    'hamanaka': 'Hamanaka', 'casagrande': 'Casagrande',
    'cardiff cashmere': 'Cardiff', 'cardiff': 'Cardiff',
    'lamana': 'Lamana', 'malabrigo': 'Malabrigo', 'urth yarns': 'Urth Yarns',
    'gedifra': 'Gedifra', 'aura': 'Aura Yarns', 'aura yarns': 'Aura Yarns',
    "adele's mohair": "Adele's Mohair", 'adele s mohair': "Adele's Mohair",
    'myak': 'MYak', 'limol': 'Limol', 'lustrosa': 'Lustrosa',
    'daruma': 'Daruma', 'daruma thread': 'Daruma', 'long chung': 'Long Chung',
    'или-или': 'ИЛИ-ИЛИ', 'ili ili': 'ИЛИ-ИЛИ',
}


# Обозначения, которые капсом по существу, а не по невнимательности.
KEEP_UPPER = {'XL', 'XXL', 'XS', 'S', 'M', 'L', 'DK', 'SW', 'GOTS', 'II', 'III', 'IV'}


def brand_of(raw, url):
    name = re.sub(r'\s*\([^)]*\)\s*$', '', (raw or '')).strip().lower()
    if name in BRAND:
        return BRAND[name]
    # У части карточек бренд в JSON-LD пуст — тогда берём его из пути товара:
    # /catalog/pryazha/<марка>/<линейка>/<id>/
    slug = url.split('/catalog/pryazha/')[-1].split('/')[0]
    slug = re.sub(r'[_-]\d+$', '', slug).replace('-', ' ').replace('yaponiya', '').strip()
    return BRAND.get(slug, slug.title() or None)


# Не пряжа, а товары рядом с ней: подарочные коробки, наборы для изделия.
# Артикулом они не являются — у набора нет ни метража, ни состава одной нити.
NOT_YARN = re.compile(r'gift\s*(box|pack)|^наборы\b|подарочн', re.I)


def line_of(title, brand):
    """Из названия убрать марку и привести капс к обычному регистру.

    Магазин пишет часть линеек капсом («ORSETTINI», «FILO DI GIO»). Ключ
    сравнения регистр игнорирует, но `name` попадает в каталог как есть, и
    «Lana Grossa ORSETTINI» рядом с «Lana Grossa Cool Wool» выглядело бы
    поломкой. Слова, которые капсом по существу, не трогаем.
    """
    t = re.sub(r'\s{2,}', ' ', (title or '').strip())
    t = re.sub(r'^' + re.escape(brand) + r'\s+', '', t, flags=re.I)
    # Звёздочка в конце — пометка магазина (распродажа/снято с производства),
    # к названию пряжи отношения не имеет. Сорок карточек, и шесть из них
    # затёрли собой уже существовавшие чистые имена.
    t = t.rstrip('*').strip()
    t = ' '.join(w if (w.upper() in KEEP_UPPER or any(c.isdigit() for c in w))
                 else (w.capitalize() if w.isupper() else w)
                 for w in t.split())
    return t.strip()


def main():
    rows = json.load(open(ROWS, encoding='utf-8'))
    out, skipped = [], []
    for r in rows:
        brand = brand_of(r.get('brand_raw'), r.get('url') or '')
        line = line_of(r.get('title'), brand or '')
        if not brand or not line or NOT_YARN.search(r.get('title') or ''):
            skipped.append(r.get('title'))
            continue
        out.append({
            'brand': brand, 'line': line, 'comp': r.get('comp') or None,
            'g': r.get('g'), 'm': r.get('m'),
            'needle': r.get('needle'), 'gauge': r.get('gauge'),
            'src': 'ili-ili.com (разбор карточек)', 'url': r.get('url'),
        })

    print(f"разобрано {len(out)}, пропущено {len(skipped)}")
    print("по маркам:", collections.Counter(r['brand'] for r in out).most_common(8))

    data = json.load(open(OUT, encoding='utf-8'))
    before = len(data['items'])
    have = {(i['brand'], i['line'], i['src']) for i in data['items']}
    added = [r for r in out if (r['brand'], r['line'], r['src']) not in have]
    data['items'].extend(added)
    notes = data.get('_source_notes')
    if isinstance(notes, list):
        notes.append('ili-ili.com — 18 страниц каталога пряжи, характеристики из JSON-LD карточек; '
                     'вес мотка в исходнике в килограммах; плотность и диапазон спиц '
                 'из блока «Детали», который опознаётся по иконкам')
    json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"добавлено {len(added)}, web_specs {before} -> {len(data['items'])}")


if __name__ == '__main__':
    main()
