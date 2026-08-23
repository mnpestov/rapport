import json
import re
import requests
from bs4 import BeautifulSoup

from .utils import normalize_url, get_base_url
from .parsers import parse_yarn, parse_density, detect_instruments, is_machine_knitting
from .hooks import _parse_woo_price


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
# ekaterinafrog.ru uses Tilda's "Cataloger" widget (t-catalog__card markup,
# distinct from both the older t754 Store block and the T396 Zero Block
# product pages themselves — see the extract_details/price hooks in
# hooks.py) — same underlying store.tildaapi.com API, storepart/recid found
# inline in the page's own t_catalog_init('2326543181', options) call
# (options.storepart='437332075062'). The API's own "text"/"descr" fields
# are populated for only 1 of 18 live products (mk_uni) — not reliable
# enough to trust site-wide, so this only resolves url/title/image here and
# hands off to the normal per-product page fetch, which already extracts
# the real description via the T396-specific extract_details hook.
discover_ekaterinafrog_products = _make_tilda_store_discovery_handler('437332075062', '2326543181', 'ekaterinafrog.ru')
# storepart/recid found inline in the page's own t_store_init('846427699', options)
# call (options.storepart='523878719412') — same discovery method as foxknit.ru
# above. API's "text" field carries the full product description (verified:
# construction/size/yarn all present, 800+ chars per product, not a teaser).
scrape_bayuma_store = _make_tilda_store_full_handler('523878719412', '846427699', 'bayuma.ru')
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

            # Full gallery, not just the listing-card cover — each product's
            # own t754__default-gallery (desktop t-slds slider, several
            # slides confirmed live e.g. on viktoria-morozova.ru) already
            # sits in this static HTML alongside the details text below, no
            # extra request needed. Ignores the parallel
            # t754__mobile-custom-gallery-list block entirely — same photos,
            # responsive duplicate, not a second source. Falls back to the
            # single listing-card js-product-img cover when a product has no
            # gallery block at all (single-photo product).
            images = []
            gallery_block = c.find(class_='t754__default-gallery')
            if gallery_block:
                for bgimg in gallery_block.select('.t-slds__main .t-slds__item .t-slds__bgimg'):
                    src = bgimg.get('data-original')
                    if not src:
                        style_match = re.search(r"url\(['\"]?(.*?)['\"]?\)", bgimg.get('style', ''))
                        src = style_match.group(1) if style_match else None
                    if src and src not in images:
                        images.append(src)

            if not images:
                for card in soup.find_all(attrs={'data-product-lid': lid}):
                    bgimg = card.find(class_='js-product-img')
                    if bgimg and bgimg.get('data-original'):
                        images.append(bgimg['data-original'])
                        break

            image_url = images[0] if images else ''

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
                'images': images,
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

def _make_tilda_named_popup_store_handler(catalog_url, label):
    # A third Tilda t754 "Store" variant, distinct from both the JSON-API
    # sites above and the "#!/tproduct/<storepartuid>-<lid>" hashroute sites
    # below (aggushop.tilda.ws — no storepartuid concept exists here at all).
    # Each catalog card's link is "#popup:<name>" where <name> is a
    # human-chosen slug per product (e.g. "#popup:karusel"), not a numeric
    # ID — but it's a genuine 1:1 mapping (verified: 24/24 cards resolve to
    # a distinct popup, 0 missing). The popup itself is a server-rendered
    # T750 block, matched via its own "data-tooltip-hook" attribute holding
    # that exact "#popup:<name>" string — full description already sits in
    # ".t750__descr" with no noise to decompose (title/price/buy-button are
    # separate sibling divs, not nested inside it, unlike the hashroute
    # variant's shared t754__content container). One fetch of the catalog
    # page has everything; no per-product request needed.
    def handler(yarn_ranges_db, instruments_db, all_existing_base_urls, headers):
        try:
            resp = requests.get(catalog_url, headers=headers, timeout=15)
            soup = BeautifulSoup(resp.text, 'html.parser')
        except Exception as e:
            print(f"Error fetching {label}: {e}")
            return [], 0

        cards = soup.select('.t754__col.js-product[data-product-lid]')
        items = []
        for card in cards:
            link = card.select_one('a.js-product-link')
            href = link.get('href') if link else None
            if not href or not href.startswith('#popup:'):
                continue
            popup = soup.select_one(f'[data-tooltip-hook="{href}"]')
            if not popup:
                continue

            product_url = f"{catalog_url}{href}"
            base_norm = get_base_url(normalize_url(product_url))
            if base_norm in all_existing_base_urls:
                continue
            all_existing_base_urls.add(base_norm)

            title_el = popup.select_one('.t750__title')
            title = title_el.get_text(strip=True) if title_el else ''

            images = []
            for bgimg in popup.select('.t-slds__bgimg'):
                src = bgimg.get('data-original')
                if not src:
                    style_match = re.search(r"url\(['\"]?(.*?)['\"]?\)", bgimg.get('style', ''))
                    src = style_match.group(1) if style_match else None
                if src and src not in images:
                    images.append(src)
            image_url = images[0] if images else ''

            # Some products append extra text after the number (e.g.
            # "490 (без скидки)" for popup:pannomore) — _parse_woo_price's
            # digit-anchored regex handles that; a bare replace/float() cast
            # (used elsewhere for the plain-numeric Tilda API/HTML prices)
            # would raise on the trailing text and silently drop the price.
            cur_price_el = popup.select_one('.t750__price .t750__price-value')
            old_price_el = popup.select_one('.t750__price_old .t750__price-value')
            price = _parse_woo_price(cur_price_el) if cur_price_el else None
            old_price = _parse_woo_price(old_price_el) if old_price_el else None
            if old_price == price:
                old_price = None

            descr_el = popup.select_one('.t750__descr')
            text_content = descr_el.get_text(separator=' ', strip=True) if descr_el else ''
            combined = title + ' ' + text_content
            details = descr_el.get_text(separator='\n', strip=True) if descr_el else None

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
                'images': images,
                'details': details,
                'price': price,
                'oldPrice': old_price,
                'densityStitches': density_s,
                'densityRows': density_r,
                'yarnRanges': unique_yarns,
                'instruments': detect_instruments(combined, instruments_db),
                'isMachineKnitting': is_machine_knitting(combined),
            })
        print(f"{label}: {len(cards)} products total, {len(items)} completely new.")
        return items, len(cards)
    return handler

scrape_aggushop_store = _make_tilda_named_popup_store_handler('https://aggushop.tilda.ws/mk', 'aggushop.tilda.ws')

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

def _fetch_taplink_json(url, headers):
    # Taplink ("link-in-bio" shop builder, taplink.st) embeds page state
    # inline as two JSON blobs, window.account and window.data — same shape
    # on the storefront listing AND on each individual product page, no
    # separate API call needed either way. Extracted with raw_decode rather
    # than a regex (safer against nested braces than a hand-rolled pattern).
    try:
        resp = requests.get(url, headers=headers, timeout=15)
    except Exception as e:
        print(f"Error fetching Taplink page {url}: {e}")
        return None, None

    def extract(marker):
        idx = resp.text.find(marker)
        if idx == -1:
            return None
        try:
            obj, _ = json.JSONDecoder().raw_decode(resp.text[idx + len(marker):])
            return obj
        except Exception:
            return None

    return extract('window.account = '), extract('window.data = ')

def _parse_taplink_product(product_url, listing_entry, headers, yarn_ranges_db, instruments_db):
    # Full per-product fetch — the storefront listing alone only carries
    # title/price/one photo/sku, no description; this page's own
    # window.data.data.product has the real description text and the
    # COMPLETE photo gallery (10 photos seen live, not just the listing
    # thumbnail).
    account, page_data = _fetch_taplink_json(product_url, headers)
    product = ((page_data or {}).get('data') or {}).get('product') or {}

    title = product.get('title') or listing_entry.get('title') or ''
    description = product.get('description') or ''

    language_code = (account or {}).get('language_code', '')
    storage_domain = 'i.taplink.st' if language_code == 'ru' else 'p.taplink.st'

    pictures = product.get('pictures') or []
    images = [f"https://{storage_domain}/p/{pic['filename']}" for pic in pictures if pic.get('filename')]
    if not images:
        cover = product.get('picture') or listing_entry.get('picture')
        if cover:
            images = [f"https://{storage_domain}/p/{cover}"]

    density_s, density_r = parse_density(description)
    yarn_meters = parse_yarn(description)
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

    combined = title + ' ' + description
    return {
        'url': product_url,
        'title': title,
        'imageUrl': images[0] if images else '',
        'images': images,
        'details': description or None,
        'price': product.get('price', listing_entry.get('price')),
        'oldPrice': product.get('price_compare', listing_entry.get('price_compare')),
        'densityStitches': density_s,
        'densityRows': density_r,
        'yarnRanges': unique_yarns,
        'instruments': detect_instruments(combined, instruments_db),
        'isMachineKnitting': is_machine_knitting(combined),
    }

def _make_taplink_store_handler(site_url, label):
    # Each product listed on the storefront ALSO has a genuine separate
    # detail page at "<scheme>://<domain>/o/<hex(product_id)>/" — e.g.
    # /o/c5f46e/ for product_id 12973166 (12973166 in hex == c5f46e).
    # This is NOT discoverable by guessing or by reading frontend.js: the
    # first attempt at this handler used "#product=<id>" on the storefront
    # URL itself, which the user caught live — it opens the homepage, not
    # the product — the real shape only surfaced from the page's own
    # <link rel="canonical"> once fetched directly by hex id.
    scheme_netloc_match = re.match(r'^(https?://[^/]+)', site_url)
    scheme_netloc = scheme_netloc_match.group(1) if scheme_netloc_match else site_url.rstrip('/')

    def handler(yarn_ranges_db, instruments_db, all_existing_base_urls, headers):
        _, page_data = _fetch_taplink_json(site_url, headers)
        if not page_data:
            print(f"{label}: failed to fetch/parse Taplink listing page.")
            return [], 0

        products = page_data.get('data', {}).get('products', [])
        items = []
        for p in products:
            product_id = p.get('product_id')
            if not product_id:
                continue

            product_url = f"{scheme_netloc}/o/{product_id:x}/"
            base_norm = get_base_url(normalize_url(product_url))
            if base_norm in all_existing_base_urls:
                continue
            all_existing_base_urls.add(base_norm)

            items.append(_parse_taplink_product(product_url, p, headers, yarn_ranges_db, instruments_db))

        print(f"{label}: {len(products)} products total, {len(items)} completely new.")
        return items, len(products)
    return handler

scrape_obnimi_mamu_store = _make_taplink_store_handler('https://obnimi-mamu.ru/m/', 'obnimi-mamu.ru')

# ── Taplink, второй макет: страницы из блоков ──────────────────────────────
#
# У Taplink два принципиально разных способа продавать. Первый — блок
# «Магазин» (обработчик выше): товары лежат готовым списком в
# window.data.data.products, у каждого свой product_id, цена отдельным полем
# и страница /o/<hex(product_id)>/. Второй — обычные страницы профиля,
# собранные из блоков: window.data.fields[].items[], страницы /p/<id>/,
# никаких «товаров» как сущности вообще нет. Так сделана
# taplink.cc/sedmoye.avgusta.
#
# Во втором макете товар — это соседство трёх блоков в разделе:
#
#   pictures  — обложка
#   text      — <b>"ПАРИЖАНКА"</b> + пара строк описания
#   link      — «ПОДРОБНЕЕ», type=page, value=<id страницы товара>
#
# а сама страница товара устроена так:
#
#   pictures  — галерея (1–9 фото)
#   text      — «С 12.08 по 31.08 цена МК 890₽ вместо 1390₽»
#   link      — «КУПИТЬ МК», внешняя ссылка на payform.ru
#   text      — длинное описание
#   break     — ↓ ниже «РАБОТЫ УЧЕНИЦ» и 15–30 чужих фотографий
#
# Разделитель break здесь принципиален: без остановки на нём в галерею
# описания попадали бы фотографии работ учениц — на некоторых страницах их
# втрое больше, чем фото самого изделия.

def _taplink_page_blocks(page_data):
    # Блоки страницы разложены по секциям (fields[].items[]), но для разбора
    # важен только их порядок на странице, а не принадлежность секции: товар
    # в листинге может начаться в одной секции и закончиться в следующей —
    # так и происходит на странице «сумки», где четвёртый товар вынесен в
    # отдельную секцию.
    return [it for fld in (page_data.get('fields') or []) for it in (fld.get('items') or [])]


def _taplink_block_text(raw):
    # Текст блока — это HTML-фрагмент с \n вместо <br> в одних местах и
    # настоящими <br> в других, плюс &nbsp; и невидимый U+200C, которым
    # редактор Taplink размечает пустые строки.
    if not raw:
        return ''
    html = re.sub(r'<br\s*/?>', '\n', raw, flags=re.IGNORECASE)
    text = BeautifulSoup(html, 'html.parser').get_text()
    return text.replace('\u200c', '').replace('\xa0', ' ').strip()


# Число с валютой: «890₽», «1 390 руб.», «440р». Точка/запятая как разделитель
# дробной части у этой площадки не встречается — цены целые.
_TAPLINK_MONEY_RE = re.compile(r'(\d[\d\s\u00a0]*)\s*(?:₽|руб\.?|р\.?(?![а-яё]))', re.IGNORECASE)
_TAPLINK_INSTEAD_RE = re.compile(r'вместо', re.IGNORECASE)


def _parse_taplink_text_price(text):
    # «С 12.08 по 31.08 цена МК 890₽ вместо 1390₽» → (890.0, 1390.0).
    # Даты не мешают: без валюты рядом число за цену не принимается.
    # Регистр слова «вместо» плавает у самого автора («440р ВМЕСТО 690р»).
    if not text:
        return None, None
    matches = [(m.start(), float(re.sub(r'[\s\u00a0]', '', m.group(1)))) for m in _TAPLINK_MONEY_RE.finditer(text)]
    if not matches:
        return None, None

    instead = _TAPLINK_INSTEAD_RE.search(text)
    if instead:
        before = [v for pos, v in matches if pos < instead.start()]
        after = [v for pos, v in matches if pos > instead.start()]
        if before and after:
            # Старая цена — та, что после «вместо»; она же обязана быть больше,
            # иначе это не скидка, а неверно разобранная строка.
            price, old_price = before[-1], after[0]
            return (price, old_price) if old_price > price else (price, None)

    return matches[0][1], None


def _taplink_storage_domain(account):
    return 'i.taplink.st' if (account or {}).get('language_code', '') == 'ru' else 'p.taplink.st'


def _taplink_pictures(block, storage_domain):
    items = ((block.get('options') or {}).get('list')) or []
    return [
        f"https://{storage_domain}/p/{it['p']['filename']}"
        for it in items
        if (it.get('p') or {}).get('filename')
    ]


def _parse_taplink_page_product(product_url, title, headers, yarn_ranges_db, instruments_db, fallback_text=''):
    account, page_data = _fetch_taplink_json(product_url, headers)
    if not page_data:
        return None

    storage_domain = _taplink_storage_domain(account)
    images, texts = [], []
    for block in _taplink_page_blocks(page_data):
        block_type = block.get('block_type_name')
        if block_type == 'break':
            break
        if block_type == 'pictures' and not images:
            images = _taplink_pictures(block, storage_domain)
        elif block_type == 'text':
            texts.append(_taplink_block_text((block.get('options') or {}).get('text')))

    price = old_price = None
    remaining = []
    for text in texts:
        if price is None:
            price, old_price = _parse_taplink_text_price(text)
            if price is not None:
                continue
        remaining.append(text)
    # Описание — самый длинный из оставшихся текстов, а не «второй по счёту»:
    # у страниц без строки с ценой порядок блоков сдвигается на один.
    details = max(remaining, key=len) if remaining else None

    density_s, density_r = parse_density(details or '')
    yarn_meters = parse_yarn(details or '')
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

    combined = f"{title} {details or ''}"
    # Инструмент этот автор в описаниях не называет ни разу — ни «крючком», ни
    # «столбик», ни «петли»: единственное упоминание техники живёт в шапке
    # профиля («МАСТЕР-КЛАССЫ ПО ВЯЗАНИЮ КРЮЧКОМ») и в короткой подписи под
    # обложкой в разделе. Поэтому если по тексту самого описания инструмент не
    # определился, пробуем ещё раз с этим контекстом. Порядок именно такой:
    # собственный текст товара всегда важнее — у автора, который продаёт и
    # крючок, и спицы, шапка профиля назовёт оба, и подменять ею конкретный
    # товар нельзя.
    instruments = detect_instruments(combined, instruments_db)
    if not instruments and fallback_text:
        instruments = detect_instruments(f"{combined} {fallback_text}", instruments_db)
    return {
        'url': product_url,
        'title': title,
        'imageUrl': images[0] if images else '',
        'images': images,
        'details': details or None,
        'price': price,
        'oldPrice': old_price,
        'densityStitches': density_s,
        'densityRows': density_r,
        'yarnRanges': unique_yarns,
        'instruments': instruments,
        'isMachineKnitting': is_machine_knitting(combined),
    }


def _strip_wrapping_quotes(text):
    # Снимаем кавычки, только если в них обёрнута ВСЯ строка. Простой
    # strip('"«»') портил названия вида «Курс по шапкам «КАЙФУЛЯ»»: там
    # закрывающая кавычка в конце есть, а открывающая — в середине, и от
    # имени оставалось «Курс по шапкам «КАЙФУЛЯ».
    pairs = (('"', '"'), ('\u00ab', '\u00bb'), ('\u201c', '\u201d'))
    changed = True
    while changed:
        changed = False
        for left, right in pairs:
            if len(text) >= 2 and text.startswith(left) and text.endswith(right):
                text = text[1:-1].strip()
                changed = True
    return text


def _taplink_page_url(profile_url, page_id):
    return f"{profile_url.rstrip('/')}/p/{page_id}/"


# Глубина обхода разделов. У этого автора она равна двум (профиль → «СУМКИ» →
# товар), запас — на случай подразделов; заодно страховка от зацикливания
# вместе с visited ниже.
_TAPLINK_MAX_DEPTH = 4


def _collect_taplink_page_products(profile_url, headers):
    # Раздел от товара отличается структурно, а не по адресу: у раздела есть
    # ссылки type=page (на товары или подразделы), у страницы товара — только
    # внешние (кнопка «КУПИТЬ»). Поэтому обход рекурсивный, без зашитых
    # id разделов: автор добавит четвёртый раздел — он подхватится сам.
    # Каждая страница скачивается ровно один раз: здесь же, где решается,
    # товар это или раздел.
    products = []
    visited = {profile_url}

    def walk(page_url, title, listing_text, depth):
        _, page_data = _fetch_taplink_json(page_url, headers)
        if not page_data:
            return

        children = []
        # Заголовок товара берётся из ТЕКСТОВОГО блока раздела, идущего перед
        # ссылкой: на самой странице товара названия нет вообще — она
        # начинается сразу с галереи и цены.
        last_text = ''
        for block in _taplink_page_blocks(page_data):
            block_type = block.get('block_type_name')
            options = block.get('options') or {}
            if block_type == 'text':
                last_text = _taplink_block_text(options.get('text'))
            elif block_type == 'link' and options.get('type') == 'page' and options.get('value'):
                # Название — первая строка текста над ссылкой, без кавычек,
                # которыми автор оформляет модель («"ПАРИЖАНКА"»). Дальше его
                # всё равно правит человек в модерации.
                child_title = _strip_wrapping_quotes(last_text.split('\n')[0].strip())
                children.append((_taplink_page_url(profile_url, options['value']), child_title, last_text))

        if not children:
            # Ссылок вглубь нет — это страница товара. У корня профиля они
            # есть всегда, так что сам профиль сюда не попадёт.
            if title:
                products.append((page_url, title, listing_text))
            return

        if depth >= _TAPLINK_MAX_DEPTH:
            return

        for child_url, child_title, child_listing_text in children:
            if child_url in visited:
                continue
            visited.add(child_url)
            walk(child_url, child_title, child_listing_text, depth + 1)

    walk(profile_url, None, '', 1)
    return products


def _make_taplink_page_store_handler(site_url, label):
    profile_url = site_url.rstrip('/')

    def handler(yarn_ranges_db, instruments_db, all_existing_base_urls, headers):
        # Магазинный макет и страничный различаются по самому ответу, а не по
        # автору: если у профиля есть блок «Магазин», разбирать нужно его —
        # там и цены, и описания приходят структурированно.
        _, root_data = _fetch_taplink_json(profile_url, headers)
        if ((root_data or {}).get('data') or {}).get('products'):
            return _make_taplink_store_handler(site_url, label)(
                yarn_ranges_db, instruments_db, all_existing_base_urls, headers
            )

        # Корень профиля уже скачан выше — берём из него текстовые блоки как
        # общий контекст для определения инструмента (см. _parse_taplink_page_product).
        profile_text = ' '.join(
            _taplink_block_text((b.get('options') or {}).get('text'))
            for b in _taplink_page_blocks(root_data or {})
            if b.get('block_type_name') == 'text'
        )

        products = _collect_taplink_page_products(profile_url, headers)
        if not products:
            print(f"{label}: Taplink page layout — no product pages found.")
            return [], 0

        items = []
        for page_url, title, listing_text in products:
            base_norm = get_base_url(normalize_url(page_url))
            if base_norm in all_existing_base_urls:
                continue
            all_existing_base_urls.add(base_norm)
            parsed = _parse_taplink_page_product(
                page_url, title, headers, yarn_ranges_db, instruments_db,
                fallback_text=f"{listing_text} {profile_text}",
            )
            if parsed:
                items.append(parsed)

        print(f"{label}: {len(products)} products total, {len(items)} completely new.")
        return items, len(products)

    return handler



scrape_sedmoye_avgusta_store = _make_taplink_page_store_handler(
    'https://taplink.cc/sedmoye.avgusta', 'taplink.cc/sedmoye.avgusta'
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
    'bayuma.ru': scrape_bayuma_store,
    'obnimi-mamu.ru': scrape_obnimi_mamu_store,
    'aggushop.tilda.ws': scrape_aggushop_store,
    # Анастасия Мартюшева / «Как я встретил вашу пряжу». Ключ включает ник
    # профиля, а не просто 'taplink.cc': обработчик замыкается на конкретный
    # адрес (site_url в диспетчер не передаётся), поэтому следующий автор на
    # этой площадке добавляется такой же строкой. Сам обработчик при этом
    # универсален — он определяет по ответу, страничный у профиля макет или
    # магазинный, и во втором случае отдаёт работу обработчику выше.
    'taplink.cc/sedmoye.avgusta': scrape_sedmoye_avgusta_store,
}

# Discovery-only handlers: same JS-hydrated-listing problem, but the product
# URLs/titles/images they resolve still need the normal per-product page
# fetch (fetch_and_parse_detail) for density/yarn/instrument parsing — used
# as a scrape_via_seed()-shaped alternative when the generic crawl finds
# nothing and no seed_url is configured. Keyed by a domain substring.
DISCOVERY_HANDLERS = {
    'knitmode.ru': discover_knitmode_products,
    'ekaterinafrog.ru': discover_ekaterinafrog_products,
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

