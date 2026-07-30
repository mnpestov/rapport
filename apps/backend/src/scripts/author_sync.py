import psycopg2
import json
import urllib.parse
import os
import sys
import requests
import re
from bs4 import BeautifulSoup
import concurrent.futures

def get_base_url(u):
    return u[:-2] if u.endswith('-1') else u

def normalize_url(url):
    try:
        parsed = urllib.parse.urlparse(url.strip().lower())
        path = parsed.path.rstrip('/')
        if not path: path = '/'
        result = f"{parsed.netloc}{path}"
        # Hash-routed SPA sites (e.g. bysergeeva.ru: "/#!/tproduct/<lid>") put the
        # only distinguishing info in the fragment — urlparse splits it off from
        # path entirely, so without this every such URL on a domain collapses to
        # the same normalized value and dedup can't tell products apart. No other
        # known site's Pattern.url has a fragment, so this is a no-op elsewhere.
        if parsed.fragment:
            result += f"#{parsed.fragment}"
        return result
    except:
        return url.strip().lower().rstrip('/')

def parse_yarn(text):
    results = []
    # \.? after the unit letters: abbreviation-with-period style ("150 м./50 гр.",
    # "50 гр./150 м") is common enough that without it, the literal "." sitting
    # between the unit and the separator/next number breaks the match entirely.
    # "," in the separator class: "50гр, 167м" (comma-space, no other joiner)
    # found on lenakotikova.ru — without it, the comma sits between the two
    # numbers unmatched by any alternative, breaking the match entirely.
    # (?:\s*-\s*\d+)? after each captured number — same "take the first/lower
    # value" fix already applied to parse_density's dash-ranges. Without it,
    # a stated range like "300-375м/100г" grabs 375 (the digit adjacent to
    # the unit marker) instead of 300 (the first/lower value convention).
    pattern1 = re.compile(r'(\d+)(?:\s*-\s*\d+)?\s*м[а-я]*\.?\s*(?:в|на|/|-|,)?\s*(\d+)(?:\s*-\s*\d+)?\s*(?:г|g|гр)\.?', re.IGNORECASE)
    pattern2 = re.compile(r'(\d+)(?:\s*-\s*\d+)?\s*(?:г|g|гр)\.?\s*(?:в|на|/|-|,)?\s*(\d+)(?:\s*-\s*\d+)?\s*м[а-я]*\.?', re.IGNORECASE)

    matches = []
    for m in pattern1.finditer(text):
        matches.append((m, m.group(1), m.group(2)))
    for m in pattern2.finditer(text):
        matches.append((m, m.group(2), m.group(1)))
        
    word_to_num = {'две': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6}
    
    for match, meters, grams in matches:
        m_val = float(meters)
        g_val = float(grams)
        if g_val == 0: continue
        
        m_per_100 = (m_val * 100) / g_val
        
        start = max(0, match.start() - 35)
        end = min(len(text), match.end() + 35)
        context = text[start:end].lower()
        
        thread_match = re.search(r'в\s+(\d+|две|три|четыре|пять|шесть)\s+(?:нит|слож)', context)
        if thread_match:
            val = thread_match.group(1)
            threads = int(val) if val.isdigit() else word_to_num.get(val, 1)
            m_per_100 = m_per_100 / threads
            
        results.append(m_per_100)
    return results

def parse_density(text):
    # \b after the bare abbreviations (п, ст, р) — without it, "п" alone matches
    # the first letter of ANY п-starting word (плотности, пряжа...), e.g. "На
    # выбор 2 плотности: 21 п. * 30 р." wrongly reads "2" (from "2 плотности")
    # as the stitch count instead of "21". пет.../столб.../ряд... already end in
    # [а-я]*, which greedily consumes to a real word boundary, so they're unaffected.
    # (?:\s*-\s*\d+...)? after each captured number — swallows a dash-range's
    # upper bound ("23-25 п") so group1/group2 land on the FIRST/lower number,
    # consistent with the "always take the first value" convention. Without it,
    # the number immediately adjacent to the unit marker wins (here, "25"), since
    # the marker check runs right after the capture with nothing to skip past it.
    pattern = re.compile(r'(\d+(?:[.,]\d+)?)(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:п\b|пет[а-я]*|ст\b|столб[а-я]*)(?:.{1,30}?)(\d+(?:[.,]\d+)?)(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:р\b|ряд[а-я]*)', re.IGNORECASE)
    for m in pattern.finditer(text):
        stitches_str = m.group(1).replace(',', '.')
        rows_str = m.group(2).replace(',', '.')
        try:
            stitches = float(stitches_str)
            rows = float(rows_str)
        except:
            continue
            
        start = max(0, m.start() - 60)
        end = min(len(text), m.end() + 30)
        context = text[start:end].lower()
        
        ignore_roots = ['узор', 'резин', 'ажур', 'платоч', 'аран', 'кос', 'рельеф']
        has_ignore = any(r in context for r in ignore_roots)
        has_allow = 'лицев' in context or 'глад' in context
        
        if has_ignore and not has_allow:
            continue
            
        is_1x1 = '1х1 см' in context or '1x1 см' in context or (stitches < 8 and rows < 8)
        if is_1x1:
            stitches *= 10
            rows *= 10

        # round(x) with no ndigits rounds to the nearest INTEGER, silently
        # destroying legitimate fractional gauge values from the source text
        # (e.g. "26,2 столбика и 12,7 рядов" -> (26, 13), losing both
        # decimals — found via lenakotikova.ru's pillow-cover series, whose
        # gauge is routinely given to one decimal place). round(x, 1) keeps
        # that precision while still trimming float noise from the str->float
        # conversion above.
        return round(stitches, 1), round(rows, 1)
    return None, None

def detect_instruments(text, instruments_db):
    # Крючок vs спицы — determined from word roots anywhere in the page text
    # (title + description). "крюч" covers крючок/крючком/крючка; "столбик"
    # (crochet-only stitch term) is a secondary signal for pages that describe
    # the technique without ever naming the tool directly. "спиц" covers
    # спицы/спицами/спицах. Single-technique shops sometimes never say "спицами"
    # at all (it's implicit store-wide) but do give a gauge in "N петель" —
    # "петл" is a needles fallback signal, but only when no crochet signal is
    # present, since crochet occasionally uses "петля" too (воздушная петля,
    # петля подъёма) — always alongside an explicit "крючок" mention in practice.
    text_lower = text.lower()
    has_crochet = bool(re.search(r'крюч|столбик', text_lower))
    # \b-anchored: "петля" declines with a fleeting vowel (петля/петли but
    # петель, петелька), so both пет+л... and пет+ел... stems are needed. Word
    # boundary keeps this from matching inside unrelated words that happen to
    # contain "пет" (компетентный, Петербург, петух...).
    has_needles = bool(re.search(r'спиц', text_lower)) or (not has_crochet and bool(re.search(r'\bпет(?:л[а-я]*|ел[а-я]*)\b', text_lower)))
    result = []
    for i_id, i_name in instruments_db:
        name_lower = i_name.lower()
        if 'крюч' in name_lower and has_crochet:
            result.append({"id": i_id, "name": i_name})
        elif 'спиц' in name_lower and has_needles:
            result.append({"id": i_id, "name": i_name})
    return result

def is_machine_knitting(text):
    # Machine knitting (вязальная машина) isn't a technique we track at all — no
    # Instrument row exists for it, and it's explicitly out of scope. "фонтур"
    # (single/double-bed terminology) is unambiguous; the phrase forms cover
    # sites that only ever say "для машин"/"машинное вязание" without "фонтур".
    return bool(re.search(r'фонтур|вязальн[а-я]*\s*машин|машинн[а-я]*\s*вязан|для\s+машин[а-я]*\b', text.lower()))

def fetch_and_parse_detail(p, yarn_ranges_db, instruments_db):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
    }
    try:
        detail_resp = requests.get(p['url'], headers=headers, timeout=10)
        detail_soup = BeautifulSoup(detail_resp.text, 'html.parser')
        
        # Extract h1/<title> before the cleanup below (harmless either way — these
        # live outside the decomposed tags anyway, but keep it up front so the
        # title fix is visually grouped with where it's read from below).
        # Only trust h1 when it's the ONLY one on the page — some sites (eiwi.ru)
        # misuse <h1> for the site logo/wordmark (and even a mobile search
        # placeholder), appearing before the real product h1 in document order,
        # so find('h1') silently grabs the wrong one. With >1 h1 present, the
        # page's own <title> tag has proven more reliable across every site
        # tested this session.
        h1_tags = detail_soup.find_all('h1')
        page_title = h1_tags[0].get_text(strip=True) if len(h1_tags) == 1 else ''
        if not page_title:
            title_tag = detail_soup.find('title')
            raw_title = title_tag.get_text(strip=True) if title_tag else ''
            # Require whitespace on BOTH sides of the separator — a bare hyphen with
            # no surrounding spaces is almost always part of the title itself (e.g.
            # "Описание-дополнение на носки"), not a "Title – Site Name" separator.
            page_title = re.sub(r'\s+[-–—|&]\s+\S.*$', '', raw_title).strip()

        # Cleanup visually noisy tags. <title> is included here (after already
        # being read above) — site-wide branding often lives there (e.g. one
        # site's <title> ends in "– knittingsamurai.ru Машинное вязание" on
        # EVERY page), and it would otherwise leak into text_content via the
        # get_text() fallback below, contaminating keyword-based detection
        # (instrument, technique, etc.) with text that has nothing to do with
        # this specific product.
        for tag in detail_soup(['nav', 'header', 'footer', 'aside', 'script', 'style', 'title']):
            tag.decompose()

        # WooCommerce "related products" widget (<section class="related products">,
        # standard across nearly all WooCommerce themes) lists OTHER items on the same
        # page — when no isolated container matches below and text_content falls back
        # to the whole page, this widget's text (other products' names/specs) leaks in
        # and contaminates keyword-based detection with unrelated products' content.
        for tag in detail_soup.find_all(class_=re.compile(r'\brelated\b')):
            tag.decompose()

        # Listing-page alt text / link text (p['title']) is used here to isolate
        # the right container on multi-product pages (Tilda popups etc.) — keep
        # using it for that match BEFORE any title correction below, since a
        # page's own h1/title always legitimately contains its own product name
        # and would match trivially, defeating the isolation.
        target_title = re.sub(r'[\W_]+', '', p['title'].lower())
        containers = detail_soup.find_all(class_=re.compile(r'js-product|t-item|t754__product-full|t-popup'))
        valid_texts = []
        valid_texts_popup = []
        is_single_product_page = False

        for c in containers:
            c_text = c.get_text(separator=' ', strip=True)
            if target_title in re.sub(r'[\W_]+', '', c_text.lower()):
                # t-popup/t-popup__container is a single SHARED modal shell Tilda
                # reuses across every product on the page — on sites where all
                # products live on one page (hash-routed "#!/tproduct/..." URLs,
                # e.g. bysergeeva.ru), this shared shell can independently satisfy
                # the title match and, being huge, wins the max(key=len) below over
                # the correct narrow per-product container — silently blending
                # multiple products' density/yarn text together. Deprioritize it:
                # only fall back to a t-popup match when nothing more specific matched.
                classes = c.get('class') or []
                if any('t-popup' in cls for cls in classes):
                    valid_texts_popup.append(c_text)
                else:
                    valid_texts.append(c_text)
                # Tilda's dedicated single-product-page block (as opposed to its
                # catalog/Store block) tags containers with "single" in the class
                # (js-product-single, t-store-product_single — seen on knitmode.ru).
                # That block is a truncated summary, not the full description — on
                # a page that's ALREADY about only this one product, isolating to
                # it is both unnecessary and lossy. Prefer the whole page instead.
                if any('single' in cls for cls in classes):
                    is_single_product_page = True

        if not valid_texts:
            valid_texts = valid_texts_popup
        if is_single_product_page:
            valid_texts = []

        # The listing page's own alt/link text is often unreliable (filename
        # fragments, photo-app captions like "Processed with VSCO...", credits)
        # even when the detail page has a clean, correctly formatted title in its
        # own <h1>/<title>. Prefer that here — it doesn't affect the isolation
        # match above, which already ran against the original listing-derived title.
        # EXCEPT for hash-routed URLs ("#!/tproduct/..." — bysergeeva.ru and similar):
        # the fragment never reaches the server, so every such URL serves the same
        # generic page and its h1/<title> is the site's own tagline, not this
        # product's name — trust the listing-derived title instead in that case.
        if page_title and '#' not in p['url']:
            p['title'] = page_title

        if valid_texts:
            text_content = max(valid_texts, key=len)
        else:
            text_content = detail_soup.get_text(separator=' ', strip=True)

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
                    
        p['densityStitches'] = density_s
        p['densityRows'] = density_r
        p['yarnRanges'] = unique_yarns
        p['instruments'] = detect_instruments(p['title'] + ' ' + text_content, instruments_db)
        p['isMachineKnitting'] = is_machine_knitting(p['title'] + ' ' + text_content)
        return p
    except Exception as e:
        print(f"Error scraping detail {p['url']}: {e}")
        p['densityStitches'] = None
        p['densityRows'] = None
        p['yarnRanges'] = []
        p['instruments'] = []
        p['isMachineKnitting'] = False
        return p

def fetch_title_and_image(url, headers):
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
        title_tag = soup.find('title')
        title = title_tag.get_text(strip=True) if title_tag else ''
        # Strip common storefront title suffixes ("- скачать на Eiwi | 123", "купить в интернет-магазине")
        title = re.sub(r'\s*[-|]\s*(скачать на|купить).*$', '', title, flags=re.I).strip()
        og_image = soup.find('meta', property='og:image')
        image_url = og_image['content'].strip() if og_image and og_image.get('content') else ''
        return title, image_url
    except Exception as e:
        print(f"Error fetching title/image for {url}: {e}")
        return '', ''

def find_seed_url(site, candidate_urls):
    # Pick any already-known URL (published pattern or sync-queue item, any
    # status) that lives on the same domain as the author's site but isn't the
    # site's own listing page — a concrete product page to bootstrap discovery
    # from when the listing page itself yields nothing (see scrape_via_seed()).
    site_domain = urllib.parse.urlparse(site).netloc
    site_path = urllib.parse.urlparse(site).path.rstrip('/')
    for url in candidate_urls:
        parsed = urllib.parse.urlparse(url)
        if parsed.netloc == site_domain and parsed.path.rstrip('/') != site_path:
            return url
    return None

def scrape_via_seed(seed_url, headers):
    # Fallback for authors whose site listing is JS-rendered (normal crawl finds
    # zero products, e.g. eiwi.ru shops). seed_url is any already-known product
    # page for this author (an existing Pattern.url or AuthorSyncItem.url on the
    # same domain — see find_seed_url() in main()); same-shape same-domain links
    # are harvested from it. These sites often leave real product <a href>
    # targets in the raw HTML (e.g. for click tracking on a "related items"
    # carousel) even though the carousel itself only renders visually via JS.
    # Individual product pages on these sites DO render server-side, so each
    # harvested link is fetched separately for its title/image before being
    # handed to the normal deep-parse pipeline.
    domain = urllib.parse.urlparse(seed_url).netloc
    seed_path = urllib.parse.urlparse(seed_url).path
    last_segment = seed_path.rsplit('/', 1)[-1]

    if re.match(r'^\d+-.+\.html$', last_segment):
        shape = re.compile(r'^/\d+-[\w-]+\.html$')
        seed_depth = None
    else:
        shape = None
        seed_depth = len([s for s in seed_path.split('/') if s])

    try:
        resp = requests.get(seed_url, headers=headers, timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
    except Exception as e:
        print(f"Error fetching seed {seed_url}: {e}")
        return []

    candidate_urls = {seed_url}
    for a in soup.find_all('a'):
        href = a.get('href')
        if not href:
            continue
        full = href if href.startswith('http') else urllib.parse.urljoin(seed_url, href)
        parsed = urllib.parse.urlparse(full)
        if parsed.netloc != domain:
            continue
        if shape is not None:
            if not shape.match(parsed.path):
                continue
        else:
            depth = len([s for s in parsed.path.split('/') if s])
            if depth != seed_depth or parsed.path == seed_path:
                continue
        candidate_urls.add(full)

    items = []
    for url in candidate_urls:
        title, image_url = fetch_title_and_image(url, headers)
        if not title:
            continue
        items.append({'url': url, 'imageUrl': image_url, 'title': title})
    print(f"Seed fallback for {seed_url}: {len(items)} product(s) discovered.")
    return items

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

def _tilda_store_image(p):
    try:
        gallery = json.loads(p.get('gallery') or '[]')
        if gallery:
            return gallery[0].get('img', '')
    except Exception:
        pass
    return ''

def _parse_tilda_store_product(p, yarn_ranges_db, instruments_db):
    title = p.get('title', '')
    text_content = BeautifulSoup(p.get('text') or '', 'html.parser').get_text(separator=' ', strip=True)
    combined = title + ' ' + text_content

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

    return {
        'url': p['url'],
        'title': title,
        'imageUrl': _tilda_store_image(p),
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
            {'url': p['url'], 'title': p.get('title', ''), 'imageUrl': _tilda_store_image(p)}
            for p in products if p.get('url')
        ]
        print(f"{label} store API: {len(items)} product(s) discovered.")
        return items
    return handler

scrape_kitirrr_store = _make_tilda_store_full_handler('225031935381', '351959523', 'kitirrr.ru')
discover_knitmode_products = _make_tilda_store_discovery_handler('779903633633', '188641560', 'knitmode.ru')
scrape_tsinbal_store = _make_tilda_store_full_handler('827480422531', '503488787', 'tsinbal.ru')
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

def _make_tilda_hashroute_store_handler(storepartuid, site_url, label):
    # Old-style Tilda hash routing ("/#!/tproduct/<storepartuid>-<lid>") —
    # the fragment never reaches the server, so every product URL serves the
    # exact same page. Unlike the store.tildaapi.com sites above, this page
    # IS server-rendered: every product's full description already sits in
    # the static HTML as a <div class="t754__product-full"
    # data-product-lid="..."> (hidden via CSS, shown by JS on click) — no
    # API call needed, just isolate each container directly from one fetch.
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

            text_content = c.get_text(separator=' ', strip=True)
            combined = title + ' ' + text_content

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
}

def _helenyakovleva_extract_image(a):
    # The t-card__link title anchor carries no image of its own — Tilda's
    # "Cards" (t774) block puts the product photo in a sibling branch of the
    # card's DOM tree (t774__imgwrapper, a sibling of the anchor's own
    # t774__content ancestor), not inside or next to the anchor itself. Walk
    # up from the anchor until an ancestor's subtree contains a bg-image div
    # (t-bgimg) and take the FIRST one in document order — each card has two
    # (a hover-swap pair, "_first_hover" then "_second"), and the first is
    # always the primary photo (verified against all 15 products on the
    # site: every one resolves, none accidentally grab the hover-alternate).
    node = a
    for _ in range(6):
        node = node.parent
        if node is None:
            break
        bgimg = node.find(class_=re.compile(r'\bt-bgimg\b'))
        if bgimg:
            if bgimg.get('data-original'):
                return bgimg.get('data-original')
            style = bgimg.get('style', '')
            m = re.search(r"url\(['\"]?(.*?)['\"]?\)", style)
            if m:
                return m.group(1)
    return None

def _lenakotikova_extract_image(a):
    # /freepatterns uses Tilda's "404" gallery block (t404) — each card's
    # bg-image div (class t-bgimg, with a data-original attribute) sits
    # directly INSIDE the anchor itself (unlike helenyakovleva.com's t774
    # cards, where it's a sibling branch), so a plain subtree search on the
    # anchor is enough, no ancestor walk-up needed.
    bgimg = a.find(class_=re.compile(r'\bt-bgimg\b'))
    if not bgimg:
        return None
    if bgimg.get('data-original'):
        return bgimg.get('data-original')
    style = bgimg.get('style', '')
    m = re.search(r"url\(['\"]?(.*?)['\"]?\)", style)
    return m.group(1) if m else None

def _hollywool_exclude_product(href):
    # Real pattern pages are exactly one slug deep under
    # /besplatnye-opisaniya/<slug>/ — facet/filter pages (by yarn
    # brand, product type, etc.) nest an extra nonempty segment, e.g.
    # /besplatnye-opisaniya/brend_pryazhi/aura/ or /izdelie/kupalnik/ —
    # or, unnested, ARE the facet root itself (/izdelie/) or a
    # sort/query variant of the base listing page.
    href_path = href.split('?')[0].split('#')[0]
    m = re.search(r'besplatnye-opisaniya/(.*)', href_path)
    segments = [s for s in (m.group(1) if m else '').split('/') if s]
    facet_roots = {'izdelie', 'brend_pryazhi'}
    return len(segments) != 1 or segments[0] in facet_roots

# Per-domain tweaks to the generic crawler's per-anchor product/pagination
# detection, keyed by a domain substring matched against site_url. Every hook
# is optional:
#   extra_product_class(a_classes) -> bool     additional signal an anchor is a product link
#   exclude_product(href)          -> bool     True to skip an otherwise-matched product anchor
#   exclude_pagination(next_url, is_category) -> bool   True to skip an otherwise-matched pagination/category link
#   extra_pagination_match(href)   -> bool     additional signal a link is a category/listing page to crawl
#   extra_valid_href_match(href)   -> bool     additional signal a link is itself a product page
#   extract_image(a)               -> str|None additional image lookup when the anchor itself has none
DOMAIN_CRAWL_HOOKS = {
    # elzestores.ru's product URLs ("/sweaters/<slug>", "/cardigans/<slug>",
    # "/skirts/<slug>") don't match any of the generic product-URL keywords
    # (no /shop/, /product/, catalog/, etc.) — the crawler already reaches
    # the /catalog listing page fine (matches "/catalog" directly), but every
    # product anchor on it gets skipped since neither has_valid_href nor
    # has_product_class recognizes these category-named paths.
    'elzestores.ru': {
        'extra_valid_href_match': lambda href: bool(re.search(r'/(sweaters|cardigans|skirts)/[\w-]+', href)),
    },
    # helenyakovleva.com uses Tilda's "Cards" block (t774) instead of the
    # "Store" block seen elsewhere — its title link carries class
    # "t-card__link" with no img/bg-image on the anchor itself (the image
    # sits in an unrelated sibling element the generic per-anchor checks
    # don't reach). "t-card" alone is too generic to trust site-wide (used
    # for all sorts of non-product Tilda blocks), so this is domain-scoped.
    'helenyakovleva.com': {
        'extra_product_class': lambda a_classes: 't-card__link' in a_classes,
        'extract_image': _helenyakovleva_extract_image,
    },
    # lenakotikova.ru's /freepatterns section uses Tilda's "404" gallery
    # block — title link carries class "t404__link", no img tag and no
    # inline style (the bg-image lives on a nested div, see
    # _lenakotikova_extract_image above).
    'lenakotikova.ru': {
        'extra_product_class': lambda a_classes: 't404__link' in a_classes,
        'extract_image': _lenakotikova_extract_image,
        # The generic is_category regex requires a literal "/pattern"
        # substring (slash immediately before "pattern") — "/freepatterns"
        # has "free" in between, so it never matches and the crawler never
        # queues that page starting from the site root.
        'extra_pagination_match': lambda href: 'freepatterns' in href,
    },
    'hollywool.ru': {
        'exclude_product': _hollywool_exclude_product,
    },
    'mustardyarn.ru': {
        'exclude_product': lambda href: 'opisanie' not in href,
        'exclude_pagination': lambda next_url, is_category: is_category and 'vse-opisanija' not in next_url,
    },
}

def _get_crawl_hooks(site_url):
    for domain, hooks in DOMAIN_CRAWL_HOOKS.items():
        if domain in site_url:
            return hooks
    return {}

def scrape_author_site(site_url, yarn_ranges_db, instruments_db, all_existing_base_urls, seed_url=None):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
    }

    # Full-site handlers — see SITE_HANDLERS above. Bypass the generic
    # crawler entirely for matched domains; every other site keeps using
    # the normal path below untouched.
    for domain, handler in SITE_HANDLERS.items():
        if domain in site_url:
            return handler(yarn_ranges_db, instruments_db, all_existing_base_urls, headers)

    hooks = _get_crawl_hooks(site_url)

    # Basic crawler to extract pattern links and images, with simple pagination support
    items = []
    visited_pages = set()
    pages_to_visit = [site_url]
    product_links_dict = {}
    all_product_links = []
    extra_total = 0

    try:
        while pages_to_visit and len(visited_pages) < 15:
            current_url = pages_to_visit.pop(0)
            if current_url in visited_pages:
                continue
                
            visited_pages.add(current_url)
            
            try:
                resp = requests.get(current_url, headers=headers, timeout=10)
                soup = BeautifulSoup(resp.text, 'html.parser')
                
                # Extract products
                site_domain = urllib.parse.urlparse(site_url).netloc
                for a in soup.find_all('a'):
                    href = a.get('href')
                    if not href:
                        continue

                    # Absolute off-domain hrefs (e.g. a "related products" widget
                    # linking to an unrelated third-party shop) can still match
                    # the product-URL patterns below (e.g. any "/shop/" path) and
                    # get misattributed as this author's own new pattern — the
                    # pagination/category loop below already guards against this
                    # for its own links, product links need the same guard.
                    if href.startswith('http') and urllib.parse.urlparse(href).netloc != site_domain:
                        continue

                    img = a.find('img')
                    bg_style = a.get('style', '')
                    has_bg_img = 'background-image' in bg_style
                    
                    has_valid_href = bool(re.search(r'/shop/|/tproduct/|/product/|/patterns/|catalog/|/opisania/|/item/|/mk|/master-klassy/', href, re.I))
                    if not has_valid_href and hooks.get('extra_valid_href_match') and hooks['extra_valid_href_match'](href):
                        has_valid_href = True
                    a_classes = a.get('class') or []
                    has_product_class = 'product' in a_classes
                    if hooks.get('extra_product_class') and hooks['extra_product_class'](a_classes):
                        has_product_class = True
                    # Category/tag/pagination listing pages (WooCommerce etc.) can still slip
                    # through the loose "/mk" substring above (e.g. "/product-category/mk-hat/")
                    # — these are handled separately below as pages to crawl, never as products.
                    is_listing_page = bool(re.search(r'/product-category/|/category/|/tag/|/page/\d|[?&]page=|PAGEN_|[?&]p=\d', href, re.I))

                    if img or has_bg_img or has_valid_href or has_product_class:
                        alt = ''
                        src = ''
                        if img:
                            alt = img.get('alt', '').strip()
                            src = img.get('data-src') or img.get('src')
                        if not src and has_bg_img:
                            m = re.search(r"url\(['\"]?(.*?)['\"]?\)", bg_style)
                            if m:
                                src = m.group(1)

                        # Tilda's lazy-loaded bg-image marker (class t-bgimg +
                        # data-original) — the inline background-image style
                        # above is only populated by JS at runtime, so on sites
                        # that don't also inline it statically, has_bg_img stays
                        # False even though data-original already has the URL.
                        if not src and a.get('data-original'):
                            src = a.get('data-original')

                        if not src and hooks.get('extract_image'):
                            src = hooks['extract_image'](a) or ''

                        if not alt:
                            alt = a.get_text(separator=' ', strip=True)
                            
                        # Support for various site structures including romnastena and annaboronbekova.
                        # img/bg-image ALONE is not enough — that swept in homepage/category/logo
                        # links on many WordPress/WooCommerce-style sites (any thumbnail-bearing nav
                        # link qualified). Require either the URL whitelist OR an explicit `product`
                        # CSS class token — the latter covers sites like likewool.shop
                        # (/master-class/<slug>, outside the whitelist, but cards carry
                        # class="product js--hover-preview").
                        if (has_valid_href or has_product_class) and (src or alt) and not is_listing_page:
                            if hooks.get('exclude_product') and hooks['exclude_product'](href):
                                continue

                            if not href.startswith('http'):
                                href = urllib.parse.urljoin(site_url, href)
                            if src and not src.startswith('http'):
                                src = urllib.parse.urljoin(site_url, src)

                            # Never treat a page the crawler itself is already treating as a
                            # listing/category page (visited or queued, including the crawl's own
                            # starting page) as a "product" — e.g. a breadcrumb/"back to catalog" link.
                            if href.rstrip('/') in (u.rstrip('/') for u in visited_pages | set(pages_to_visit) | {site_url}):
                                continue

                            if href not in product_links_dict:
                                product_links_dict[href] = {
                                    'url': href,
                                    'imageUrl': src,
                                    'title': alt
                                }
                            else:
                                if not product_links_dict[href]['title'] and alt:
                                    product_links_dict[href]['title'] = alt
                                if not product_links_dict[href]['imageUrl'] and src:
                                    product_links_dict[href]['imageUrl'] = src
                                
                # Extract pagination and category links
                for a in soup.find_all('a'):
                    href = a.get('href')
                    if not href:
                        continue
                        
                    is_pagination = re.search(r'page=|PAGEN_|[\?&]p=', href, re.I)
                    is_category = re.search(r'/shop|/catalog|/pattern|/mk|/store|/category|/market|/master-klassy', href, re.I)
                    if not is_category and hooks.get('extra_pagination_match') and hooks['extra_pagination_match'](href):
                        is_category = True

                    if is_pagination or is_category:
                        if 'cart' in href.lower() or 'checkout' in href.lower():
                            continue
                            
                        if not href.startswith('http'):
                            next_url = urllib.parse.urljoin(site_url, href)
                        else:
                            next_url = href
                            
                        if hooks.get('exclude_pagination') and hooks['exclude_pagination'](next_url, is_category):
                            continue

                        # Only follow links on the same domain
                        domain = urllib.parse.urlparse(site_url).netloc
                        next_domain = urllib.parse.urlparse(next_url).netloc
                        
                        if domain == next_domain and next_url not in visited_pages and next_url not in pages_to_visit:
                            pages_to_visit.append(next_url)
            except Exception as e:
                print(f"Error scraping page {current_url}: {e}")
                
        all_product_links = list(product_links_dict.values())

        # Normal crawl found nothing (typical of JS-rendered listing pages) —
        # try a domain-specific discovery API first, else fall back to a
        # known product page, if the author has one configured.
        discovery_handler = None
        for domain, handler in DISCOVERY_HANDLERS.items():
            if domain in site_url:
                discovery_handler = handler
                break
        if not all_product_links and discovery_handler:
            for item in discovery_handler(headers):
                if item['url'] not in product_links_dict:
                    product_links_dict[item['url']] = item
            all_product_links = list(product_links_dict.values())
        elif not all_product_links and seed_url:
            print(f"No products found via normal crawl on {site_url}, trying seed {seed_url}...")
            for item in scrape_via_seed(seed_url, headers):
                if item['url'] not in product_links_dict:
                    product_links_dict[item['url']] = item
            all_product_links = list(product_links_dict.values())

        # EARLIER DEDUPLICATION
        new_product_links = []
        for p in all_product_links:
            base_norm = get_base_url(normalize_url(p['url']))
            if base_norm not in all_existing_base_urls:
                new_product_links.append(p)
                all_existing_base_urls.add(base_norm) # Mark as seen to avoid duplicates within same run
                
        print(f"Found {len(all_product_links)} products on {site_url}. {len(new_product_links)} are completely new.")

        # Supplemental full-parse store sections — see SUPPLEMENTAL_STORE_HANDLERS
        # above. Runs unconditionally alongside whatever the generic crawl (+
        # DISCOVERY_HANDLERS) found, since this covers content the crawler
        # structurally cannot see regardless of success elsewhere on the site.
        extra_items = []
        for domain, handler in SUPPLEMENTAL_STORE_HANDLERS.items():
            if domain in site_url:
                extra_items, extra_total = handler(yarn_ranges_db, instruments_db, all_existing_base_urls, headers)
                break

        if not new_product_links and not extra_items:
            return extra_items, len(all_product_links) + extra_total

        # ASYNCHRONOUS DEEP PARSE
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(fetch_and_parse_detail, p, yarn_ranges_db, instruments_db) for p in new_product_links]
            for future in concurrent.futures.as_completed(futures):
                parsed_p = future.result()
                items.append(parsed_p)
        items.extend(extra_items)

    except Exception as e:
        print(f"Error scraping {site_url}: {e}")
    return items, len(all_product_links) + extra_total

def main():
    # Optional CLI arg: a single Author.id to sync instead of every author —
    # used by the admin UI's per-author "Проверить новинки" button. Everything
    # else (global URL dedup prefetch, categories/yarn/instruments lookups,
    # enrichment, DB writes) runs identically either way.
    target_author_id = sys.argv[1] if len(sys.argv) > 1 else None

    db_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5434/knitting_catalog')
    if '?' in db_url:
        db_url = db_url.split('?')[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    # Pre-fetch ALL known URLs from the database globally ONCE
    print("Loading global URL database for deduplication...")
    cursor.execute('SELECT url FROM "Pattern" WHERE url IS NOT NULL')
    db_urls = {normalize_url(row[0]) for row in cursor.fetchall() if row[0]}
    
    cursor.execute('SELECT url FROM "AuthorSyncItem" WHERE url IS NOT NULL')
    sync_urls = {normalize_url(row[0]) for row in cursor.fetchall() if row[0]}

    base_db_urls = {get_base_url(u) for u in db_urls}
    base_sync_urls = {get_base_url(u) for u in sync_urls}
    all_existing_base_urls = base_db_urls.union(base_sync_urls)
    print(f"Loaded {len(all_existing_base_urls)} known unique URLs.")

    if target_author_id:
        # Separate literal query (rather than appending "AND id = %s" to the
        # bulk query below) — once a params tuple is passed, psycopg2 parses
        # the WHOLE string for %-placeholders, so the LIKE patterns' bare %
        # must be doubled to %% here (unlike the params-free branch below).
        cursor.execute("""
            SELECT id, name, site FROM "Author"
            WHERE id = %s AND site IS NOT NULL
            AND site NOT LIKE '%%t.me%%'
            AND site NOT LIKE '%%vk.com%%'
            AND site NOT LIKE '%%instagram.com%%'
        """, (target_author_id,))
    else:
        cursor.execute("""
            SELECT id, name, site FROM "Author"
            WHERE site IS NOT NULL
            AND site NOT LIKE '%t.me%'
            AND site NOT LIKE '%vk.com%'
            AND site NOT LIKE '%instagram.com%'
        """)

    authors = cursor.fetchall()

    # Existing per-author URLs (published patterns + anything already sitting in
    # the sync queue, any status) — used as seed candidates for scrape_via_seed()
    # when an author's own site listing is JS-rendered and yields nothing on its
    # own. No dedicated "seed URL" field needed: as soon as a single product from
    # a domain exists anywhere in our data, it can bootstrap discovery of the rest.
    author_urls = {}
    cursor.execute('SELECT "authorId", url FROM "Pattern" WHERE url IS NOT NULL')
    for author_id, url in cursor.fetchall():
        author_urls.setdefault(author_id, []).append(url)
    cursor.execute('''
        SELECT r."authorId", i.url FROM "AuthorSyncItem" i
        JOIN "AuthorSyncReport" r ON i."reportId" = r.id
        WHERE i.url IS NOT NULL
    ''')
    for author_id, url in cursor.fetchall():
        author_urls.setdefault(author_id, []).append(url)

    # Fetch categories
    cursor.execute('SELECT id, name FROM "ProductType"')
    categories_db = cursor.fetchall()

    # Fetch YarnRanges
    cursor.execute('SELECT id, label, "minValue", "maxValue" FROM "YarnRange" ORDER BY "minValue"')
    yarn_ranges_db = cursor.fetchall()

    # Fetch Instruments (крючок/спицы)
    cursor.execute('SELECT id, name FROM "Instrument"')
    instruments_db = cursor.fetchall()

    stats = []

    for author_id, author_name, site in authors:
        print(f"---")
        print(f"Processing {site}...")
        seed_url = find_seed_url(site, author_urls.get(author_id, []))
        parsed_items, site_count = scrape_author_site(site, yarn_ranges_db, instruments_db, all_existing_base_urls, seed_url)
        
        # Calculate db_count
        cursor.execute('SELECT COUNT(*) FROM "Pattern" WHERE "authorId" = %s', (author_id,))
        db_pattern_count = cursor.fetchone()[0]
        
        cursor.execute('''
            SELECT COUNT(i.id) FROM "AuthorSyncItem" i 
            JOIN "AuthorSyncReport" r ON i."reportId" = r.id 
            WHERE r."authorId" = %s
        ''', (author_id,))
        db_sync_count = cursor.fetchone()[0]
        
        db_count = db_pattern_count + db_sync_count
        
        stats.append({
            'name': author_name,
            'site': site,
            'site_count': site_count,
            'db_count': db_count
        })
        
        # Enrich items
        for item in parsed_items:
            title_lower = item['title'].lower()
            matched_categories = []
            for cat_id, cat_name in categories_db:
                if cat_name.lower() in title_lower:
                    matched_categories.append({"id": cat_id, "name": cat_name})
            
            # Additional fallback logic for typical words
            if not matched_categories:
                # Top
                if any(w in title_lower for w in ['top', 'топ', 'футболка', 'майка']):
                    for cid, cname in categories_db:
                        if cname.lower() == 'топ':
                            matched_categories.append({"id": cid, "name": cname})
                            break
                # Sweater / Jumper
                elif any(w in title_lower for w in ['джемпер', 'свитер', 'пуловер', 'sweater', 'jumper']):
                    for cid, cname in categories_db:
                        if cname.lower() in ['свитер', 'джемпер']:
                            matched_categories.append({"id": cid, "name": cname})
                            break
                # Cardigan
                elif any(w in title_lower for w in ['cardigan', 'кардиган']):
                    for cid, cname in categories_db:
                        if cname.lower() == 'кардиган':
                            matched_categories.append({"id": cid, "name": cname})
                            break
                # Dress
                elif any(w in title_lower for w in ['dress', 'платье', 'сарафан']):
                    for cid, cname in categories_db:
                        if cname.lower() == 'платье':
                            matched_categories.append({"id": cid, "name": cname})
                            break
                # Hat
                elif any(w in title_lower for w in ['hat', 'шапка', 'чепчик', 'берет', 'beanie', 'балаклава']):
                    for cid, cname in categories_db:
                        if cname.lower() == 'головной убор':
                            matched_categories.append({"id": cid, "name": cname})
                            break
                # Socks
                elif any(w in title_lower for w in ['socks', 'носки', 'гольфы', 'следки']):
                    for cid, cname in categories_db:
                        if cname.lower() == 'носки':
                            matched_categories.append({"id": cid, "name": cname})
                            break
                # Bag
                elif any(w in title_lower for w in ['bag', 'сумка', 'шоппер', 'авоська']):
                    for cid, cname in categories_db:
                        if cname.lower() == 'сумка':
                            matched_categories.append({"id": cid, "name": cname})
                            break
                # Vest
                elif any(w in title_lower for w in ['vest', 'жилет', 'безрукавка']):
                    for cid, cname in categories_db:
                        if cname.lower() == 'жилет':
                            matched_categories.append({"id": cid, "name": cname})
                            break
            
            # Deduplicate categories
            seen_cat = set()
            unique_cats = []
            for c in matched_categories:
                if c['id'] not in seen_cat:
                    unique_cats.append(c)
                    seen_cat.add(c['id'])
                    
            item['categories'] = unique_cats
            # Remove defaults, let the parser output dictate
            if 'densityStitches' not in item or item['densityStitches'] is None:
                item['densityStitches'] = None
            if 'densityRows' not in item or item['densityRows'] is None:
                item['densityRows'] = None
            if 'yarnRanges' not in item:
                item['yarnRanges'] = []
            if 'instruments' not in item:
                item['instruments'] = []
            if 'isMachineKnitting' not in item:
                item['isMachineKnitting'] = False
            item['isFree'] = False
        
        # Save to DB
        if parsed_items:
            try:
                cursor.execute("""
                    INSERT INTO "AuthorSyncReport" ("id", "authorId", "status", "updatedAt") 
                    VALUES (gen_random_uuid(), %s, 'PENDING', now())
                    ON CONFLICT ("authorId") WHERE status = 'PENDING' DO UPDATE SET "updatedAt" = now()
                    RETURNING id
                """, (author_id,))
                report_id = cursor.fetchone()[0]
    
                for item in parsed_items:
                    # Machine knitting isn't tracked at all (no Instrument row, out of
                    # scope) — save it straight to REJECTED so it never clutters the
                    # admin review queue, while still counting as "known" for dedup.
                    status = 'REJECTED' if item.get('isMachineKnitting') else 'PENDING'
                    cursor.execute("""
                        INSERT INTO "AuthorSyncItem" ("id", "reportId", "status", "url", "title", "parsedData")
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                        ON CONFLICT ("reportId", "url") DO NOTHING
                    """, (report_id, status, item['url'], item['title'], json.dumps(item)))
                
                conn.commit() 
                print(f"Saved {len(parsed_items)} new items for {site}")
            except Exception as e:
                conn.rollback()
                print(f"Failed to save {author_id}: {e}")
        else:
            print(f"No new items for {site}")

    # Generate Markdown Table — bulk runs only. A single-author run would
    # otherwise clobber the full cross-author report with just one row.
    if not target_author_id:
        md_lines = []
        md_lines.append("| Автор | Ссылка на сайт | кол-во описаний на сайте | кол-во описаний в бд |")
        md_lines.append("|---|---|---|---|")

        # Sort by author name
        stats.sort(key=lambda x: x['name'])
        for s in stats:
            md_lines.append(f"| {s['name']} | {s['site']} | {s['site_count']} | {s['db_count']} |")

        md_content = "\\n".join(md_lines)

        log_path = os.path.join(os.path.dirname(__file__), 'sync_stats.md')
        with open(log_path, 'w', encoding='utf-8') as f:
            f.write(md_content)

        print(f"\\nStats saved to {log_path}")

if __name__ == "__main__":
    main()
