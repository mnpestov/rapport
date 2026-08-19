import re
import urllib.parse
import requests
from bs4 import BeautifulSoup
import concurrent.futures

from .utils import normalize_url, get_base_url
from .parsers import parse_yarn, parse_density, detect_instruments, is_machine_knitting
from .hooks import _extract_details_text, extract_price_any_known_platform, _generic_extract_gallery, _get_crawl_hooks
from .handlers import SITE_HANDLERS, DISCOVERY_HANDLERS, SUPPLEMENTAL_STORE_HANDLERS


def fetch_and_parse_detail(p, yarn_ranges_db, instruments_db, hooks=None):
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

        # Full product gallery — generic crawler sites only ever get one image
        # from the listing-page card (product_links_dict), this reuses the SAME
        # detail-page fetch already happening here for density/yarn parsing, no
        # extra request. Runs AFTER the noise/related-widget decompose above so
        # a misc "related products" carousel elsewhere on the page can't be
        # picked up as this product's own gallery. Site-specific hook (see
        # DOMAIN_CRAWL_HOOKS extract_gallery, e.g. hollywool.ru) takes priority
        # when configured; _generic_extract_gallery is the cross-site fallback
        # for every other author — see pattern_images_plan.md for why a fully
        # universal approach can't be exact and why this stays best-effort.
        gallery_hook = hooks.get('extract_gallery') if hooks else None
        gallery = (gallery_hook(detail_soup, detail_resp.text, p['url']) if gallery_hook else None) or _generic_extract_gallery(detail_soup)
        if gallery:
            resolved = []
            for src in gallery:
                if src and not src.startswith('http'):
                    src = urllib.parse.urljoin(p['url'], src)
                if src:
                    resolved.append(src)
            if resolved:
                p['images'] = resolved

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
                # Keeps the container tag alongside its flattened text (not just
                # the text) so a "Подробности" version with real line breaks can
                # be re-extracted from the SAME winning container below, without
                # touching the space-joined text_content regexes already rely on.
                classes = c.get('class') or []
                if any('t-popup' in cls for cls in classes):
                    valid_texts_popup.append((c, c_text))
                else:
                    valid_texts.append((c, c_text))
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

        # Site-specific description containers that don't need — and, in at
        # least one confirmed case, can actively FAIL — the title-matching
        # loop above: each of these page shapes carries exactly one product
        # per URL (verified: always exactly 1 match on every page checked),
        # so whatever the container says IS this product's description, no
        # disambiguation required.
        #   - .description.js-description .text.f__2: the same white-label
        #     Russian shop-builder platform used by a large share of authors
        #     on this site (efgesha.ru, knitprofi.ru, leya-koss.ru,
        #     likewool.shop, nadin-shop.com, pankovanonna.com, purple-deer-
        #     knits.ru, voobrazhalkina.com, mashapatterns.ru, crochet-
        #     together.com, and more). Originally title-gated like the Tilda
        #     classes above, but moved here after a real miss:
        #     mashapatterns.ru's container text starts "Описание носков
        #     Гербариум..." (genitive "носков") while the stored product
        #     title is "Носки Гербариум" (nominative "Носки") — the
        #     normalized-substring check doesn't survive Russian case
        #     endings, so a legitimate match was silently dropped. Trusting
        #     the container unconditionally sidesteps that entire class of
        #     failure for this platform.
        #     The narrower ".text.f__2" (verified: always exactly 1 match,
        #     nested directly inside .description.js-description) isolates
        #     just the actual description paragraph — the outer
        #     .description.js-description also wraps this product's own
        #     price/stock-count/buy-button markup (see
        #     _extract_js_description_platform_price in hooks.py) that would
        #     otherwise leak into the start of every "Подробности" on this
        #     platform. Kept as a fallback to the bare outer container for
        #     any page shape on this platform without that inner div.
        #   - .woocommerce-product-details__short-description: standard
        #     WooCommerce (any theme) — verified on annetta-handmade.ru,
        #     knittingsamurai.ru.
        #   - .product__text: romnastena.com's own catalog.
        #   - .hw-rich-description: hollywool.ru (Bitrix custom theme — same
        #     site as the extract_gallery hook above).
        #   - .textDesk: eiwi.ru (DLE) — the actual description block; distinct
        #     from the gallery's own JS-embedded array handled separately in
        #     _eiwi_extract_gallery.
        #   - .preview-desc[itemprop="description"]: omalica.ru (Bitrix) — the
        #     server-rendered product description (unlike its price widget,
        #     this one isn't JS-populated; confirmed present with real <p>
        #     children on live pages).
        #   - #tab-description: annasuturina.ru (WooCommerce Blocks theme) —
        #     no .woocommerce-product-details__short-description on this
        #     theme at all; the full description lives in the standard
        #     WooCommerce "Description" tab panel instead. Kept AFTER the
        #     short-description selector so a site with both (short
        #     description near the price, matching the pattern used
        #     elsewhere) keeps using the shorter, already-verified one.
        # First match wins.
        if not valid_texts:
            for selector in [
                '.description.js-description .text.f__2',
                '.description.js-description',
                '.woocommerce-product-details__short-description',
                '.product__text',
                '.hw-rich-description',
                '.textDesk',
                '.preview-desc[itemprop="description"]',
                '#tab-description',
            ]:
                fallback_container = detail_soup.select_one(selector)
                if fallback_container:
                    valid_texts = [(fallback_container, fallback_container.get_text(separator=' ', strip=True))]
                    break

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

        # Tries every markup-shape-based price mechanism implemented so far
        # (WooCommerce .woocommerce-Price-amount / <ins>/<del>, the
        # js-description platform's .product-price-min/-discount, hollywool.ru's
        # Bitrix .hw-lab-price widget, etc.) in sequence — see
        # extract_price_any_known_platform's own docstring in hooks.py for why
        # this chain lives in ONE place shared with check_price_updates.py.
        # Runs BEFORE text_content/details below (not after, as originally
        # written) specifically so the price-noise decompose right after it
        # can run before the is_single_product_page whole-page fallback —
        # extracting the price first, then stripping its own markup out,
        # rather than the other way round which would leave nothing to
        # extract from.
        p['price'], p['oldPrice'] = extract_price_any_known_platform(detail_soup, p['url'], headers)

        # Tilda's native price widgets (any block number — .js-store-price-
        # wrapper on the "t744" family, .t784__price-wrapper on the "Cards"
        # family seen on helenyakovleva.com, etc. — see
        # _extract_tilda_store_popup_price's own comment on why block
        # numbers aren't hardcoded) leak their own price text + buy button
        # into the whole-page is_single_product_page fallback below
        # (confirmed live: "Юнион-джемпер p016 590 р. р. Купить
        # Джемпер...", "...Anthemis 400 р. Добавить в корзину..." — price
        # and the button both up front). Strip both out with a wildcard
        # class match rather than one selector per block number; harmless
        # no-op on every other platform/selector shape.
        for tag in detail_soup.select('[class*="price-wrapper"], .t-btn'):
            tag.decompose()

        if valid_texts:
            winning_container, text_content = max(valid_texts, key=lambda pair: len(pair[1]))
        else:
            winning_container = None
            text_content = detail_soup.get_text(separator=' ', strip=True)

        # Domain-specific full text extraction (see DOMAIN_CRAWL_HOOKS,
        # e.g. wool-style.ru) — for sites whose real description sits in
        # one of several visually-identical sibling containers with no CSS
        # marker distinguishing it from the page's title block or other
        # unrelated text, so neither the title-matching isolation above nor
        # the shared fallback-selector list can find it. Takes priority
        # over both — including feeding text_content, so density/yarn
        # regex parsing below runs against this clean text instead of the
        # noisy whole-page fallback.
        details_hook = hooks.get('extract_details') if hooks else None
        hook_details = details_hook(detail_soup) if details_hook else None
        if hook_details:
            text_content = hook_details

        # "Подробности" — same confidence tiers as text_content above, but
        # re-extracted with real line breaks (separator='\n') rather than
        # reusing the space-joined string, so paragraph structure survives
        # for the page's white-space: pre-wrap rendering. A dedicated
        # extraction (not a .replace on text_content) since collapsing
        # whitespace loses the original newlines entirely.
        #   - extract_details hook fired -> highest confidence, use it
        #   - isolated container matched -> high confidence, use it
        #   - no container, but page is already about just this one product
        #     (is_single_product_page) -> medium confidence, whole page
        #   - no container AND not a single-product page -> low confidence;
        #     regexes tolerate this noisy whole-page fallback fine, but a
        #     read-facing text block does not (nav remnants, unrelated
        #     sections) — leave details empty rather than risk garbage.
        exclude_paragraph_hook = hooks.get('exclude_details_paragraph') if hooks else None
        if hook_details:
            p['details'] = hook_details
        elif winning_container is not None:
            p['details'] = _extract_details_text(winning_container, exclude_paragraph_hook)
        elif is_single_product_page:
            p['details'] = detail_soup.get_text(separator='\n', strip=True) or None
        else:
            p['details'] = None

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
        p['details'] = None
        p['price'] = None
        p['oldPrice'] = None
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
                    # add-to-cart= is WooCommerce's "quick add" action link on the shop listing
                    # itself (e.g. "/shop/?add-to-cart=131736") — same base path as the listing
                    # page, not a product detail page, so it slips past has_valid_href's loose
                    # "/shop/" match and shows up as a fake product with no title/image
                    # (confirmed on annasuturina.ru: title "Магазин", 0 photos).
                    is_listing_page = bool(re.search(r'/product-category/|/category/|/tag/|/page/\d|[?&]page=|PAGEN_|[?&]p=\d|add-to-cart=', href, re.I))

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
            futures = [executor.submit(fetch_and_parse_detail, p, yarn_ranges_db, instruments_db, hooks) for p in new_product_links]
            for future in concurrent.futures.as_completed(futures):
                parsed_p = future.result()
                items.append(parsed_p)
        items.extend(extra_items)

    except Exception as e:
        print(f"Error scraping {site_url}: {e}")
    return items, len(all_product_links) + extra_total

