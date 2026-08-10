import json
import requests
from bs4 import BeautifulSoup

from .utils import normalize_url, get_base_url
from .parsers import parse_yarn, parse_density, detect_instruments, is_machine_knitting


def _fetch_tilda_store_products(storepartuid, recid, label, headers):
    # Tilda "Store" blocks that are 100% client-side hydrated — no product
    # links exist anywhere in the static HTML, neither on the listing page
    # nor via a "related products" widget on detail pages (unlike eiwi.ru),
    # so neither the generic crawler below nor scrape_via_seed() can find
    # anything. Tilda's own private Store API (undocumented — storepartuid/
    # recid only obtainable via a live browser network trace, never present
    # in the static page) returns the full product list in one call.
    api_url = (
        f"https://store.tildaapi.com/api/getproductslist/?storepartuid={storepartuid}"
        f"&recid={recid}&getparts=true&getoptions=true&slice=1&size=200&flag_root=withroot"
    )
    try:
        resp = requests.get(api_url, headers=headers, timeout=15)
        return resp.json().get('products', [])
    except Exception as e:
        print(f"Error fetching {label} store API: {e}")
        return []

def _tilda_store_images(p):
    # Tilda Store's API returns the FULL product gallery in one call — no
    # per-product page fetch needed to get more than the cover. Backend
    # write paths (processSyncBatch) fall back to a single imageUrl for
    # sites that don't go through this handler (see pattern_images_plan.md
    # риски №1/2), so this always returns a list, never a bare string.
    try:
        gallery = json.loads(p.get('gallery') or '[]')
        return [g['img'] for g in gallery if g.get('img')]
    except Exception:
        return []

def _parse_tilda_store_api_price(raw):
    # Tilda Store API's price/priceold fields are plain numeric strings, not
    # display text — no currency symbol to strip, but two different decimal
    # formats seen across live domains: "700.0000" (dot, price) and
    # "1490,00" (comma, priceold) — comma here is genuinely the decimal
    # separator (not a thousands separator like Woo's display strings), so
    # a blind digit-strip like _parse_woo_price's would corrupt it (turn
    # "1490,00" into 149000). priceold is '' (falsy) when no discount.
    if not raw:
        return None
    try:
        return float(str(raw).replace(',', '.').replace(' ', ''))
    except ValueError:
        return None

def _parse_tilda_store_product(p, yarn_ranges_db, instruments_db):
    title = p.get('title', '')
    text_soup = BeautifulSoup(p.get('text') or '', 'html.parser')
    text_content = text_soup.get_text(separator=' ', strip=True)
    combined = title + ' ' + text_content
    # Always high confidence — the API's "text" field is already scoped to
    # exactly this one product, no isolation/fallback needed like the
    # generic crawler. separator='\n' (not the space-joined text_content
    # above) so paragraph breaks survive for the page's pre-wrap rendering.
    details = text_soup.get_text(separator='\n', strip=True) or None

    density_s, density_r = parse_density(text_content)
    yarn_meters = parse_yarn(text_content)
    unique_yarns = []
    seen_y = set()
    for ym in set(yarn_meters):
        for y_id, y_name, y_min, y_max in yarn_ranges_db:
            if y_max is None: y_max = 999999
            if y_min <= ym <= y_max:
                if y_id not in seen_y:
                    unique_yarns.append({"id": y_id, "label": y_name})
                    seen_y.add(y_id)
                break

    price = _parse_tilda_store_api_price(p.get('price'))
    old_price = _parse_tilda_store_api_price(p.get('priceold'))
    if old_price == price:
        old_price = None

    return {
        'url': p['url'],
        'title': title,
        'images': _tilda_store_images(p),
        'details': details,
        'price': price,
        'oldPrice': old_price,
        'densityStitches': density_s,
        'densityRows': density_r,
        'yarnRanges': unique_yarns,
        'instruments': detect_instruments(combined, instruments_db),
        'isMachineKnitting': is_machine_knitting(combined),
    }

def _make_tilda_store_full_handler(storepartuid, recid, label):
    # Use when the API's own "text" field already carries each product's
    # COMPLETE description (verified for kitirrr.ru) — parses density/yarn
    # straight from the API response and skips the per-product page fetch
    # entirely, faster than the normal path.
    def handler(yarn_ranges_db, instruments_db, all_existing_base_urls, headers):
        products = _fetch_tilda_store_products(storepartuid, recid, label, headers)
        items = []
        for p in products:
            if not p.get('url'):
                continue
            base_norm = get_base_url(normalize_url(p['url']))
            if base_norm in all_existing_base_urls:
                continue
            all_existing_base_urls.add(base_norm)
            items.append(_parse_tilda_store_product(p, yarn_ranges_db, instruments_db))
        print(f"{label} store API: {len(products)} products total, {len(items)} completely new.")
        return items, len(products)
    return handler

def _make_tilda_multi_store_full_handler(sections, label):
    # Some sites (lavkabulavka.com) split their catalog across several
    # independent Tilda Store blocks — one per category page (clothes,
    # accessories, bags, free patterns, home decor) — each with its own
    # storepartuid/recid pair (found by grepping each page's inline
    # t_store_init(...) call, same discovery method as the single-section
    # sites above). Results are merged and deduplicated by URL — a product
    # can be tagged into more than one section (e.g. a scarf/hat combo
    # listed under both "accessories" and "clothes").
    def handler(yarn_ranges_db, instruments_db, all_existing_base_urls, headers):
        seen_urls = set()
        items = []
        for storepartuid, recid in sections:
            for p in _fetch_tilda_store_products(storepartuid, recid, label, headers):
                if not p.get('url') or p['url'] in seen_urls:
                    continue
                seen_urls.add(p['url'])
                base_norm = get_base_url(normalize_url(p['url']))
                if base_norm in all_existing_base_urls:
                    continue
                all_existing_base_urls.add(base_norm)
                items.append(_parse_tilda_store_product(p, yarn_ranges_db, instruments_db))
        print(f"{label} store API ({len(sections)} sections): {len(seen_urls)} products total, {len(items)} completely new.")
        return items, len(seen_urls)
    return handler

def _make_tilda_store_discovery_handler(storepartuid, recid, label):
    # Use when the API's "text" field is only a short marketing teaser, not
    # the real pattern description (verified for knitmode.ru — density/yarn
    # info lives on the actual product page, already handled correctly by
    # fetch_and_parse_detail per this session's earlier density-fix work for
    # this exact site). This only resolves url/title/image from the API —
    # same shape as scrape_via_seed() — and hands off to the normal
    # per-product deep-parse pipeline for everything else.
    def handler(headers):
        products = _fetch_tilda_store_products(storepartuid, recid, label, headers)
        items = [
            {'url': p['url'], 'title': p.get('title', ''), 'images': _tilda_store_images(p)}
            for p in products if p.get('url')
        ]
        print(f"{label} store API: {len(items)} product(s) discovered.")
        return items
    return handler

scrape_kitirrr_store = _make_tilda_store_full_handler('225031935381', '351959523', 'kitirrr.ru')
# storepart/recid found inline in the page's own t_store_init('927359896', options)
# call (options.storepart='903544897722') — no live browser trace needed here,
# it was sitting in the static HTML this time. API's "text" field carries the
# full product description (verified: yarn thickness mentioned inline).
scrape_foxknit_store = _make_tilda_store_full_handler('903544897722', '927359896', 'foxknit.ru')
discover_knitmode_products = _make_tilda_store_discovery_handler('779903633633', '188641560', 'knitmode.ru')
scrape_tsinbal_store = _make_tilda_store_full_handler('827480422531', '503488787', 'tsinbal.ru')
scrape_knithappens_store = _make_tilda_store_full_handler('233633767262', '1366229501', 'knithappens.ru')
scrape_lavkabulavka_store = _make_tilda_multi_store_full_handler(
    [
        ('683175431561', '336506525'),   # /clothes
        ('560698987201', '336511034'),   # /accessories
        ('162415681281', '336506426'),   # /bags
        ('124891535411', '866022053'),   # /freepatterns
        ('497210869703', '2503817561'),  # /lbhome (home decor)
    ],
    'lavkabulavka.com'
)
scrape_lenakotikova_shop_store = _make_tilda_multi_store_full_handler(
    [
        ('521369177112', '242976439'),
        ('353760773042', '1275014991'),
        ('904469969012', '1270465011'),
    ],
    'lenakotikova.ru/shop'
)

def _make_tilda_hashroute_store_handler(storepartuid, site_url, label, extra_decompose_selectors=None):
    # Old-style Tilda hash routing ("/#!/tproduct/<storepartuid>-<lid>") —
    # the fragment never reaches the server, so every product URL serves the
    # exact same page. Unlike the store.tildaapi.com sites above, this page
    # IS server-rendered: every product's full description already sits in
    # the static HTML as a <div class="t754__product-full"
    # data-product-lid="..."> (hidden via CSS, shown by JS on click) — no
    # API call needed, just isolate each container directly from one fetch.
    #
    # extra_decompose_selectors: optional list of CSS selectors to strip out
    # of each product's isolated container before reading its details text —
    # e.g. loonymax.tilda.ws embeds a repeated "→ ПОЛУЧИТЬ ДОСТУП" payment
    # link (a[href*="payform.ru"]) inline in the descr block, twice per
    # product, with no <p>/<li> wrapper to hang an exclude_paragraph-style
    # hook on. None for bysergeeva.ru/likavyazhi.ru (no such noise found).
    def handler(yarn_ranges_db, instruments_db, all_existing_base_urls, headers):
        try:
            resp = requests.get(site_url, headers=headers, timeout=15)
            soup = BeautifulSoup(resp.text, 'html.parser')
        except Exception as e:
            print(f"Error fetching {label}: {e}")
            return [], 0

        for tag in soup(['nav', 'header', 'footer', 'aside', 'script', 'style', 'title']):
            tag.decompose()

        full_containers = soup.find_all('div', class_='t754__product-full')
        items = []
        for c in full_containers:
            lid = c.get('data-product-lid')
            if not lid:
                continue
            product_url = f"{site_url}#!/tproduct/{storepartuid}-{lid}"
            base_norm = get_base_url(normalize_url(product_url))
            if base_norm in all_existing_base_urls:
                continue
            all_existing_base_urls.add(base_norm)

            title_el = soup.find(attrs={'field': f'li_title__{lid}'})
            title = title_el.get_text(strip=True) if title_el else ''

            image_url = ''
            for card in soup.find_all(attrs={'data-product-lid': lid}):
                bgimg = card.find(class_='js-product-img')
                if bgimg and bgimg.get('data-original'):
                    image_url = bgimg['data-original']
                    break

            # Standard Tilda "t754" Store-block price markup, same family as
            # the store.tildaapi.com JSON price/priceold above but exposed
            # as static HTML here instead — .t754__price-value holds the
            # current price, .t754__price_old .t754__price-value the old one
            # (empty text, not absent, when no discount — verified live).
            cur_price_el = c.select_one('.t754__price .t754__price-value')
            old_price_el = c.select_one('.t754__price_old .t754__price-value')
            price = _parse_tilda_store_api_price(cur_price_el.get_text(strip=True)) if cur_price_el else None
            old_price = _parse_tilda_store_api_price(old_price_el.get_text(strip=True)) if old_price_el else None
            if old_price == price:
                old_price = None

            # Price/currency text and the "Добавить в корзину" button both
            # live inside c alongside the real description — decompose them
            # BEFORE reading text_content/details so neither leaks in (same
            # noise problem already fixed for the js-description platform).
            price_wrap = c.select_one('.t754__price-wrapper')
            if price_wrap:
                price_wrap.decompose()
            buy_btn = c.select_one('.t754__btn')
            if buy_btn:
                buy_btn.decompose()
            for selector in (extra_decompose_selectors or []):
                for el in c.select(selector):
                    el.decompose()

            text_content = c.get_text(separator=' ', strip=True)
            combined = title + ' ' + text_content
            # Always high confidence — c is already isolated to this one
            # product via data-product-lid, no fallback needed.
            details = c.get_text(separator='\n', strip=True) or None

            density_s, density_r = parse_density(text_content)
            yarn_meters = parse_yarn(text_content)
            unique_yarns = []
            seen_y = set()
            for ym in set(yarn_meters):
                for y_id, y_name, y_min, y_max in yarn_ranges_db:
                    if y_max is None: y_max = 999999
                    if y_min <= ym <= y_max:
                        if y_id not in seen_y:
                            unique_yarns.append({"id": y_id, "label": y_name})
                            seen_y.add(y_id)
                        break

            items.append({
                'url': product_url,
                'title': title,
                'imageUrl': image_url,
                'details': details,
                'price': price,
                'oldPrice': old_price,
                'densityStitches': density_s,
                'densityRows': density_r,
                'yarnRanges': unique_yarns,
                'instruments': detect_instruments(combined, instruments_db),
                'isMachineKnitting': is_machine_knitting(combined),
            })
        print(f"{label}: {len(full_containers)} products total, {len(items)} completely new.")
        return items, len(full_containers)
    return handler

scrape_bysergeeva_store = _make_tilda_hashroute_store_handler('582150733', 'https://bysergeeva.ru/', 'bysergeeva.ru')
scrape_likavyazhi_store = _make_tilda_hashroute_store_handler('1251845301', 'https://likavyazhi.ru/shop', 'likavyazhi.ru')
# Repeated "→ ПОЛУЧИТЬ ДОСТУП" payment link (twice per product, no <p>/<li>
# wrapper) — see extra_decompose_selectors docstring above.
scrape_loonymax_store = _make_tilda_hashroute_store_handler(
    '1855568811', 'https://loonymax.tilda.ws/', 'loonymax.tilda.ws',
    extra_decompose_selectors=['a[href*="payform.ru"]'],
)
scrape_viktoria_morozova_store = _make_tilda_hashroute_store_handler(
    '355898097', 'https://viktoria-morozova.ru/', 'viktoria-morozova.ru'
)

# Full-site handlers that bypass the generic crawler entirely (JS-hydrated
# stores where the generic per-anchor loop finds nothing on the page itself,
# AND the API response carries each product's complete description so no
# per-product page fetch is needed either). Keyed by a domain substring
# matched against site_url.
SITE_HANDLERS = {
    'kitirrr.ru': scrape_kitirrr_store,
    'bysergeeva.ru': scrape_bysergeeva_store,
    'lavkabulavka.com': scrape_lavkabulavka_store,
    'tsinbal.ru': scrape_tsinbal_store,
    'knithappens.ru': scrape_knithappens_store,
    'foxknit.ru': scrape_foxknit_store,
}

# Discovery-only handlers: same JS-hydrated-listing problem, but the product
# URLs/titles/images they resolve still need the normal per-product page
# fetch (fetch_and_parse_detail) for density/yarn/instrument parsing — used
# as a scrape_via_seed()-shaped alternative when the generic crawl finds
# nothing and no seed_url is configured. Keyed by a domain substring.
DISCOVERY_HANDLERS = {
    'knitmode.ru': discover_knitmode_products,
}

# Supplemental full-parse store sections: for sites where PART of the
# catalog is plain server-rendered (already found by the generic crawler
# below, or via a DOMAIN_CRAWL_HOOKS-assisted crawl) and another part sits
# in a JS-hydrated Tilda Store block the crawler structurally cannot see —
# e.g. lenakotikova.ru, where /freepatterns is a normal page but /shop is a
# Store block. Unlike SITE_HANDLERS (full bypass) or DISCOVERY_HANDLERS
# (fallback only when the crawl finds nothing), these run UNCONDITIONALLY
# alongside the generic crawl, merging their own fully-parsed items into the
# final result. Keyed by a domain substring.
SUPPLEMENTAL_STORE_HANDLERS = {
    'lenakotikova.ru': scrape_lenakotikova_shop_store,
    # likavyazhi.ru: most patterns are standalone alias pages with no site
    # nav linking to them at all (orphaned — genuinely undiscoverable by any
    # crawler, not a script bug), but /shop is the same hash-routed Tilda
    # Store pattern as bysergeeva.ru.
    'likavyazhi.ru': scrape_likavyazhi_store,
    # loonymax.tilda.ws: same hash-routed Tilda Store pattern too — the
    # generic crawler already discovers SOME of its products (confirmed:
    # this author already had patterns in the DB pre-dating this handler),
    # supplemental rather than a full SITE_HANDLERS bypass so that existing
    # discovery path isn't displaced, only reinforced.
    'loonymax.tilda.ws': scrape_loonymax_store,
    # viktoria-morozova.ru: same hash-routed Tilda Store pattern (26
    # products confirmed on one fetch of the homepage) — same reasoning as
    # loonymax.tilda.ws above.
    'viktoria-morozova.ru': scrape_viktoria_morozova_store,
}

