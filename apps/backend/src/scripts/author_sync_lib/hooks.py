import copy
import re
import json
import math
import time
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup


# Единственный настоящий перенос строки внутри <p> — это <br>: любые пробелы
# и переводы строк в самом исходнике HTML схлопывает в один пробел, а <br>
# браузер рисует переносом. get_text(separator=' ') этой разницы не видит и
# склеивает всё в одну строку — а "Подробности" на фронте выводятся с
# white-space: pre-wrap, то есть ровно так, как лежат в БД. У авторов, чьё
# описание — один <p>, набитый <br> (шаблон InSales и подобные), из-за этого
# получалась сплошная простыня текста вместо списка пряжи по строкам.
# Замена делается на КОПИИ тега: сам detail_soup к этому моменту уже отдал
# text_content и цену выше по стеку, и портить его для последующих хуков
# (галерея, exclude_paragraph) нельзя.
_BR_MARK = '\x00'  # маркер, которого заведомо нет в тексте страницы


def _block_text(tag):
    if tag.find('br') is None:
        return tag.get_text(separator=' ', strip=True)
    clone = copy.copy(tag)
    for br in clone.find_all('br'):
        br.replace_with(_BR_MARK)
    text = clone.get_text(separator=' ', strip=True)
    # strip=True срезал пробелы по краям каждой строки, но вокруг самого
    # маркера они остаются — их наставил separator=' '. [^\S\n] — пробелы,
    # кроме перевода строки: настоящие переносы, пришедшие из текста, тут
    # не трогаем.
    text = re.sub(r'[^\S\n]*' + _BR_MARK + r'[^\S\n]*', '\n', text)
    # <br><br> в разметке — пустая строка между абзацами; три и больше подряд
    # к пустой строке и сводим, чтобы не тянуть в БД вертикальные дыры.
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _extract_details_text(container, exclude_paragraph=None):
    # Build from direct <p> children when present, so a per-domain
    # exclude_paragraph hook (see DOMAIN_CRAWL_HOOKS) can drop boilerplate
    # that repeats verbatim on every one of an author's product pages
    # (delivery method, contact info, copyright notices) — not possible with
    # a single flattened get_text() call, which mashes every paragraph
    # together with no seams to filter on. Falls back to the whole
    # container's text when there are no <p> tags to split on.
    #
    # The "no <p> at all -> whole container" gate stays keyed on <p> alone
    # (not "no <p>/<li>/<tr>"), even though <li>/<tr> ARE also collected once
    # inside the <p>-driven branch below — some generic-crawler containers
    # (Tilda t-popup/snippet shells with no real <p> markup at all) can
    # still contain a single incidental <tr> from Tilda's own grid-layout
    # plumbing (not real content, e.g. lenakotikova.ru's product snippet: 0
    # <p>, 1 <tr> that's just the "В корзину" button's layout row). Keying
    # the branch choice on <tr> presence too made that ONE stray row win
    # over the whole-container fallback, silently dropping everything else
    # in the container that isn't itself inside a <p>/<li>/<tr> — a real
    # regression caught live on lenakotikova.ru/loonymax.tilda.ws while
    # verifying the <li>/<tr> extension below (added for hollywool.ru).
    paragraphs = container.find_all('p')
    if not paragraphs:
        text = container.get_text(separator='\n', strip=True)
        if not text:
            return None
        # elena-ianson.ru's js-description container has NO <p> tags at all
        # (just <br>-separated flat text), so the <p>-based exclude_paragraph
        # filtering below never even runs for it — get_text(separator='\n')
        # still gives one line per <br>-delimited chunk, so the same
        # exclude_paragraph callback can filter line-by-line here too.
        if exclude_paragraph:
            lines = [line for line in text.split('\n') if line and not exclude_paragraph(line)]
            text = '\n'.join(lines)
        return text or None

    # hollywool.ru's rich-text descriptions lean heavily on <ul> (skills,
    # yarn/recipe lists, tools) and a <table> (size chart) alongside plain
    # <p> paragraphs — extracting <p> alone silently dropped all of that.
    # <tr> rows are rendered as their cells joined with " | " (e.g. a
    # size-chart row -> "S | 81-86 | 54"). Only reached once <p> presence
    # already confirmed this container holds real prose, not a Tilda layout
    # shell — see the gate above.
    blocks = container.find_all(['p', 'li', 'tr'])
    texts = []
    for tag in blocks:
        if tag.name == 'tr':
            cells = [c.get_text(separator=' ', strip=True) for c in tag.find_all(['td', 'th'])]
            t = ' | '.join(c for c in cells if c)
        else:
            t = _block_text(tag)
        if not t:
            continue
        if exclude_paragraph and exclude_paragraph(t):
            continue
        texts.append(t)
    return '\n\n'.join(texts) or None

_WOO_PRICE_NUM_RE = re.compile(r'\d[\d.,]*')

def _parse_woo_price(bdi_tag):
    # The <bdi>'s own text is e.g. "590.00₽" — the currency symbol is a
    # nested <span> concatenated onto the number by get_text(), not a
    # separate node to skip. Anchor the match on the first actual DIGIT
    # rather than blindly keeping every dot/comma found anywhere in the
    # string — some themes put a text currency abbreviation BEFORE the
    # number with its own period, e.g. knittingsamurai.ru's
    # "руб.1,900" (currency = "руб." with a literal '.'): a blanket
    # keep-digits/dots/commas-anywhere strip turned that into ".1900" ->
    # float 0.19, a real bug caught live comparing against the site's
    # actual displayed price. Starting the match at the first digit skips
    # straight past any such prefix.
    #
    # Whitespace is stripped FIRST, separately — hollywool.ru uses a
    # non-breaking space (\xa0, matched by \s) as ITS OWN thousands
    # separator inside the digit run itself (e.g. "1\xa0000 ₽"): left in
    # place, the digit-anchored regex below stops at the very first
    # non-[\d.,] character it hits, truncating "1\xa0000" down to just "1"
    # — a real regression caught live comparing against the fix above.
    raw = re.sub(r'\s', '', bdi_tag.get_text(strip=True))
    match = _WOO_PRICE_NUM_RE.search(raw)
    if not match:
        return None
    num = match.group(0)

    # Comma is ambiguous across WooCommerce locales — knittingsamurai.ru's
    # "1,900" is comma-as-THOUSANDS (dot-decimal or no decimal shown at
    # all), but galasheikh.ru's "1150,00" is comma-as-DECIMAL (Russian
    # locale's woocommerce_price_decimal_sep) — blindly stripping every
    # comma turned that into 115000, a 100x-inflated price, real bug caught
    # live comparing against the site's actual displayed price. Thousands
    # groups are always exactly 3 digits; a currency's decimal part is
    # always 2 (kopecks/cents) — that's a reliable, distinct signal to tell
    # them apart without a per-site flag. When both '.' and ',' appear
    # together, the RIGHTMOST one is the real decimal separator (handles
    # "1.490,00" European and "1,490.00" American style alike) — not yet
    # seen live on any registered site, but cheap to handle correctly.
    if ',' in num and '.' in num:
        if num.rindex(',') > num.rindex('.'):
            cleaned = num.replace('.', '').replace(',', '.')
        else:
            cleaned = num.replace(',', '')
    elif ',' in num and re.search(r',\d{2}$', num):
        cleaned = num.replace(',', '.')
    else:
        cleaned = num.replace(',', '')

    try:
        return float(cleaned)
    except ValueError:
        return None

def _extract_woocommerce_price(soup):
    # Standard WooCommerce price markup, same across virtually every theme
    # (verified on annetta-handmade.ru) — <ins>/<del> only both appear when
    # a sale price is active: <del> is the old (struck-through) price,
    # <ins> the current one. Scoped to .summary first (the main product-info
    # column) so a "related products" widget's own price blocks — if for
    # some reason not already decomposed — can't be picked up instead.
    #
    # Loops over EVERY matching candidate rather than trusting the first
    # (select_one) — annasuturina.ru (WooCommerce Blocks / Interactivity API
    # theme, no .summary at all) renders several EMPTY .price placeholders
    # before the real one: <ins data-wp-text="state.itemPrice"></ins> with
    # no text content, populated client-side only. select_one's first match
    # landed on one of those and returned (None, None) even though a real
    # "600.00₽" <bdi> existed later on the same page. Harmless no-op on
    # every other site checked so far — they only ever have exactly one
    # matching .price element, so the loop runs once same as before.
    #
    # Also matches .wc-block-components-product-price — on the SAME theme,
    # the actual server-rendered price block (the one with real text) does
    # NOT carry a bare "price" class at all, only this Blocks-specific one;
    # the 3 empty ".price" placeholders above are a separate, unrelated
    # widget instance elsewhere on the page.
    candidates = soup.select('.summary .price') or soup.select('.price, .wc-block-components-product-price')
    for price_el in candidates:
        ins_bdi = price_el.select_one('ins .woocommerce-Price-amount bdi')
        del_bdi = price_el.select_one('del .woocommerce-Price-amount bdi')
        if ins_bdi and del_bdi:
            return _parse_woo_price(ins_bdi), _parse_woo_price(del_bdi)

        single_bdi = price_el.select_one('.woocommerce-Price-amount bdi')
        if single_bdi:
            return _parse_woo_price(single_bdi), None

    return None, None

def _extract_js_description_platform_price(soup):
    # The same white-label shop-builder platform behind the unconditional
    # ".description.js-description" details fallback (see crawlers.py —
    # efgesha.ru, knitprofi.ru, leya-koss.ru, likewool.shop, nadin-shop.com,
    # pankovanonna.com, purple-deer-knits.ru, voobrazhalkina.com,
    # mashapatterns.ru, crochet-together.com, and more) also shares one price
    # markup: a plain ".product-price-min" span holds the price with no
    # discount active; when a sale IS active that same span additionally
    # carries a ".product-price-old" class and a sibling ".product-price-
    # discount" span holds the actual (lower) current price. Verified live
    # on efgesha.ru (both states), voobrazhalkina.com and purple-deer-
    # knits.ru (no-discount state).
    #
    # Scoped to inside .description.js-description itself — that container
    # wraps its own product's price alongside the description text (same
    # place _extract_details_text's caller narrows down to .text.f__2), but
    # a page can ALSO carry several unrelated ".product-price-min" spans
    # inside a "similar products" widget elsewhere (confirmed on purple-
    # deer-knits.ru: 6 such widget prices vs. the 1 real one). Restricting
    # the search to this container is what excludes those.
    container = soup.select_one('.description.js-description')
    if not container:
        return None, None

    discount_el = container.select_one('.product-price-discount')
    min_el = container.select_one('.product-price-min')
    if discount_el:
        return _parse_woo_price(discount_el), (_parse_woo_price(min_el) if min_el else None)
    if min_el:
        return _parse_woo_price(min_el), None

    return None, None


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

_GALLERY_NOISE_RE = re.compile(r'related|similar|recommend|also-?bought|upsell|cross-?sell|you-?may|you-?might', re.I)
_GALLERY_IMG_EXT_RE = re.compile(r'\.(jpe?g|png|webp|gif)(\?|$)', re.I)

def _generic_extract_gallery(soup):
    # Best-effort, cross-site fallback for authors with no dedicated
    # extract_gallery hook (see DOMAIN_CRAWL_HOOKS) — there is no universal
    # markup for "the product gallery" across arbitrary CMSs/themes, so this
    # only trusts a handful of widely-adopted, fairly specific conventions
    # and returns nothing (falls back to the single listing-page cover)
    # rather than risk pulling in unrelated images from a misdetected
    # container. Runs on the ALREADY-cleaned soup (nav/header/footer/aside
    # and "related" sections already decomposed by the caller), which is
    # itself a big chunk of the false-positive protection.
    seen = set()
    urls = []

    def add(src):
        if src and src not in seen and _GALLERY_IMG_EXT_RE.search(src):
            seen.add(src)
            urls.append(src)

    # 1. Lightbox plugin markers (Fancybox, Magnific Popup, lightGallery,
    #    PhotoSwipe, Venobox, old-style rel="lightbox") — these specifically
    #    mark "click for full-size photo of THIS thing", rarely reused for
    #    unrelated widgets the way generic slider classes sometimes are.
    for el in soup.select('[data-fancybox], [data-lightbox], [rel="lightbox"], [data-pswp-src]'):
        add(el.get('href') or el.get('data-fancybox-src') or el.get('data-pswp-src') or el.get('data-lightbox'))

    # 2. Vigbo (cdn-sh*.vigbo.com — a hosted shop platform used by several
    #    authors here, e.g. efgesha.ru, knitprofi.ru) lazy-loads gallery
    #    images as a placeholder <img> whose real src is split across
    #    data-base-path (shop+product-scoped folder, protocol-relative) and
    #    data-file-name — confirmed on live product pages. The bare
    #    "<base><filename>" concatenation 404s: the CDN requires a size-key
    #    prefix ("<key>-<filename>") taken from the sibling data-sizes JSON
    #    (e.g. {"2":{...},"3":{...},"500":{...}}) — confirmed via the page's
    #    own og:image, which uses the largest key ("3-<filename>" in that
    #    case). Picks the largest-area size available per image rather than
    #    hardcoding "3" since the set of keys isn't guaranteed across shops.
    if not urls:
        for img in soup.select('[class*="product-gallery"] img[data-base-path][data-file-name]'):
            base = img.get('data-base-path') or ''
            name = img.get('data-file-name') or ''
            if not base or not name:
                continue
            size_key = None
            sizes_raw = img.get('data-sizes')
            if sizes_raw:
                try:
                    sizes = json.loads(sizes_raw)
                    size_key = max(
                        sizes,
                        key=lambda k: sizes[k].get('width', 0) * sizes[k].get('height', 0)
                    )
                except Exception:
                    size_key = None
            add(base + (f'{size_key}-{name}' if size_key else name))

    # 3. WooCommerce's own product-gallery block — one per product page,
    #    structurally distinct from its "related products" widget.
    if not urls:
        for img in soup.select('.woocommerce-product-gallery__image img, .woocommerce-product-gallery img'):
            add(img.get('data-src') or img.get('src'))

    # 4. Generic slider/carousel libraries (Swiper, Slick, OwlCarousel) under
    #    an explicitly product/gallery-named container only — these same
    #    libraries are just as often used for "related products" carousels,
    #    so an unqualified `.swiper`/`.slick-slider` match isn't trusted here.
    #    Substring match on the container's own class (`[class*=...]`), not
    #    an exact `.product-gallery` selector — BEM-style themes (Vigbo
    #    included) name the real container "product-gallery__slider-item"
    #    etc., never the bare token an exact class selector requires.
    #    product__img(-col) — confirmed live on romnastena.com: a plain,
    #    non-slider BEM container ("product__img-col") holding several
    #    server-rendered <img src> siblings directly, no lightbox/slider
    #    library at all — just more <img> tags than the single-cover
    #    listing-card scrape sees.
    if not urls:
        for container in soup.select(
            '[class*="product-gallery"], [class*="product-images"], [class*="product-photos"], [class*="product__img"]'
        ):
            container_signature = ' '.join([container.get('id', '')] + (container.get('class') or []))
            if _GALLERY_NOISE_RE.search(container_signature):
                continue
            for img in container.select('img'):
                add(img.get('data-src') or img.get('src'))

    # 5. Tilda's own native slider widget (class "t-slds") — a plain photo
    #    carousel, not the JSON-API-driven "Store" block already covered by
    #    handlers.py's dedicated Tilda Store extraction (different feature,
    #    different markup). Seen on ordinary product pages built with
    #    Tilda's ready-made blocks (e.g. helenyakovleva.com's "Cards" t774
    #    block) that have nothing to do with a Store — confirmed live.
    #    Scoped to the FIRST `.t-slds` found on the page only, not every
    #    slider site-wide — a page can carry an unrelated second slider
    #    (e.g. a "recommended products" carousel) elsewhere. Looping
    #    sliders pad the DOM with cloned slides at the start/end for
    #    seamless infinite scroll (verified live: last 1-2 slides repeat
    #    the first 1-2, byte-identical URLs) — `add()`'s own dedup already
    #    handles that, no special-casing needed.
    #    meta[itemprop="image"] (schema.org ImageObject) is the cleanest
    #    signal Tilda puts on every slide; data-original on the slide's own
    #    .t-bgimg is the fallback when that meta tag is missing.
    if not urls:
        slider = soup.select_one('.t-slds')
        if slider:
            for item in slider.select('.t-slds__item'):
                meta_img = item.select_one('meta[itemprop="image"]')
                src = meta_img.get('content') if meta_img else None
                if not src:
                    bgimg = item.select_one('.t-bgimg[data-original]')
                    src = bgimg.get('data-original') if bgimg else None
                add(src)

    return urls[:12]

def _extract_hollywool_price(soup):
    # Bitrix "lab-price" widget: <strong data-hw-current-price> always holds
    # a real price; <s data-hw-old-price> is ALSO always present with a
    # value (even with no discount it's a copy of the current price — hence
    # the plain HTML `hidden` attribute Bitrix toggles on it), so its mere
    # presence is not itself a discount signal. Verified live on 2 real
    # product pages: no discount found on hollywool.ru's free-description
    # catalog as of this check — <s> was `hidden` with the SAME value as
    # <strong> on both. Trust `hidden`; also guard on equal values in case a
    # page ever renders a stale/duplicate <s> without the attribute.
    container = soup.select_one('.hw-lab-price')
    if not container:
        return None, None

    current_el = container.select_one('[data-hw-current-price]')
    if not current_el:
        return None, None
    current = _parse_woo_price(current_el)

    old_el = container.select_one('[data-hw-old-price]')
    if not old_el or old_el.has_attr('hidden'):
        return current, None
    old = _parse_woo_price(old_el)
    if old == current:
        return current, None
    return current, old

_EIWI_SALE_P_RE = re.compile(r"var\s+saleP\s*=\s*'([^']*)'")

def _extract_eiwi_price(soup):
    # eiwi.ru (DLE, same subdomain-per-author platform as _eiwi_extract_gallery
    # above): current price is #priceFull (a bare number, no currency symbol
    # inside the tag — the ₽ sign is a sibling <em>, not nested, so no
    # cleanup needed beyond what _parse_woo_price already does). #oldpriceFull
    # is a DIFFERENT signal shape than hollywool.ru's: it's not hidden via an
    # attribute, it's simply rendered with EMPTY text when no discount is
    # active — verified live on 3 real product pages across 2 authors, all
    # with an empty #oldpriceFull. _parse_woo_price already returns None for
    # empty/unparseable text (float('') raises, caught), so no separate
    # emptiness check is needed here — just the equal-value guard as a second
    # line of defense, same as elsewhere.
    current_el = soup.find(id='priceFull')
    if not current_el:
        return None, None
    current = _parse_woo_price(current_el)

    old_el = soup.find(id='oldpriceFull')
    old = _parse_woo_price(old_el) if old_el else None

    # A SECOND, platform-wide discount mechanism, independent of the
    # per-product #oldpriceFull above (that one is set by the seller's own
    # "create a sale" admin action and already baked server-side into the
    # static HTML — nothing more to do for it). This one is a site-wide
    # promo the eiwi.ru template itself runs: a plain-text JS variable
    # `var saleP = '0.7';` sits in the page's own inline <script> (visible
    # to a plain fetch, confirmed live — no headless browser needed), and
    # client-side JS multiplies the displayed price by it on every product
    # page when active (saleP present, numeric, and != 1). Verified live
    # against a real active promo on Бабушка Каро/Каролина's eiwi.ru pages:
    # base price 590, saleP '0.7' -> browser shows 413/590 — the exact
    # int(590*0.7) truncation the site's own JS does
    # (`Math.trunc(normPric*(100-perc)/100)`, perc derived from saleP the
    # same way). Only applies when there's no ALREADY-active per-product
    # discount (old is still None here) — the two aren't meant to stack.
    if old is None and current is not None:
        sale_p_match = None
        for script in soup.find_all('script'):
            if script.string and 'saleP' in script.string:
                sale_p_match = _EIWI_SALE_P_RE.search(script.string)
                if sale_p_match:
                    break
        if sale_p_match:
            try:
                sale_p = float(sale_p_match.group(1))
            except ValueError:
                sale_p = None
            if sale_p is not None and sale_p != 1:
                # Deliberately NOT trunc(old * sale_p) — mathematically the
                # same real number, but a different float-rounding path than
                # the site's own two-step percentage math, and the two
                # disagree often enough to matter (690 * 0.7 = 482.99999999999994
                # -> trunc 482, one ruble off live vs the site, which computes
                # via an intermediate integer percent instead — verified live,
                # see comment above). Replicate the site's exact two steps.
                old = current
                perc = math.trunc(100 - math.trunc(sale_p * 100))
                current = math.trunc(old * (100 - perc) / 100)

    if old == current:
        old = None
    return current, old

def _extract_wool_style_price(soup):
    # wool-style.ru (Strikingly-style page constructor, "str-bw_*" classes)
    # has no dedicated price element at all — the number IS the visible
    # label of the main "buy" button (class "strwf_button"), e.g. "990
    # рублей" (verified live: detalis_casual). A second, alternate buy
    # button sometimes sits right after with the same class plus
    # "strwf_button-two" and inline "display:none" (an A/B variant, not
    # shown) — looping and taking the first button whose OWN text starts
    # with a digit naturally skips both that hidden variant and the plain
    # contact-form submit buttons ("Отправить" etc., no leading digit)
    # sharing unrelated classes on the same page.
    for btn in soup.select('.strwf_button'):
        text = btn.get_text(strip=True)
        if text and text[0].isdigit():
            return _parse_woo_price(btn), None
    return None, None

def _wool_style_extract_gallery(soup, raw_html=None, url=None):
    # wool-style.ru's photo slider (".strw-slider__image") has no <img> tag
    # at all — each slide is a div with an inline "background-image:
    # url(...)" style, same shape the generic crawler already knows how to
    # pull off listing-page cards (see the has_bg_img handling in
    # scrape_author_site) but _generic_extract_gallery doesn't look for on
    # detail pages. Dedup while preserving DOM order — the same photo CDN
    # URL is never repeated across slides in what's been checked live.
    images = []
    seen = set()
    for el in soup.select('.strw-slider__image'):
        style = el.get('style', '')
        m = re.search(r"url\(['\"]?(.*?)['\"]?\)", style)
        if m and m.group(1) and m.group(1) not in seen:
            seen.add(m.group(1))
            images.append(m.group(1))
    return images or None

def _extract_galasheikh_details(soup):
    # galasheikh.ru: crawlers.py's fallback selector list tries
    # ".woocommerce-product-details__short-description" before
    # "#tab-description" — on most WooCommerce sites the short-description
    # IS a real (if brief) product blurb, but on this site it's a repeated
    # shipping/account-access notice identical on every product page ("Все
    # купленные МК и ВИДЕО сразу автоматически добавляются в Ваш Личный
    # кабинет...", no density/yarn/needle info at all), so it wins the
    # "first match" fallback and the real description — sitting in the
    # standard WooCommerce Description tab instead — never gets reached.
    # Verified live: #tab-description carries the full text (плотность,
    # спицы, пряжа), confirmed present on every product checked.
    #
    # Deliberately NOT the shared _extract_details_text (or any
    # separator=' '/'\n' get_text call) — some of this author's product
    # pages (verified: leto, volna, gracia) look like a PDF/Word paste:
    # numbers are split across several ADJACENT <span> runs with no real
    # whitespace between them in the source at all, e.g.
    # "<span>2</span><span>6</span>" for "26" (class "bumpedFont15" gives
    # it away). Any separator that forces a space/newline at EVERY tag
    # boundary turns that into "2 6", and parse_density then reads "2" as
    # the row count instead of "26" — a real bug caught live comparing
    # against the site's own displayed "Плотность: 20 петель * 26 рядов".
    # Plain get_text() (no separator, no per-node strip — strip=True would
    # itself eat the real, meaningful trailing space inside e.g.
    # "<strong>23 </strong>петли") reproduces exactly what a browser would
    # render, correct on both this fragmented-markup style AND the other
    # pages' plain <strong>-wrapped one. Only the OUTER edges of each
    # block are trimmed (Python .strip(), not BeautifulSoup's), for the
    # exact same reason.
    #
    # <p>/<li> alone isn't enough either — leto/volna/gracia's PDF-paste
    # bullet lines ("• JarnArt Jeans ... 160м/50г ...", "• Alize Cotton
    # Gold ... 330м/100 г ...") aren't <li>s at all, there's no <ul> on the
    # page anywhere; each line is its own bare <div class="s21">/<div
    # class="s23"> sibling of the surrounding <p>s. Missing them dropped
    # the yarn lines silently — real bug caught live comparing against the
    # page's own visible "Оригинальная пряжа и аналог" list, which came
    # back as two empty labels with nothing in between.
    #
    # Widening the search to ['p', 'div', 'li'] naively would also match
    # the 2-3 layers of pure single-child WRAPPER divs #tab-description
    # itself sits inside (.wc-tab-inner etc.) — those contain ALL of the
    # above blocks again, so collecting them too would duplicate the
    # entire description. Filtering to only tags with no <p>/<div>/<li>
    # descendant of their own keeps exactly the leaf content blocks
    # (bullet divs, real <li>s in a real <ul> — e.g. ariel-kostum's yarn
    # list — and <p>s alike) regardless of how many wrapper layers a given
    # product's page happens to have, without hardcoding a specific
    # nesting depth.
    el = soup.select_one('#tab-description')
    if not el:
        return None
    blocks = [tag for tag in el.find_all(['p', 'div', 'li']) if not tag.find(['p', 'div', 'li'])]
    texts = [t for t in (tag.get_text().strip() for tag in blocks) if t]
    return '\n\n'.join(texts) or None

def _wool_style_extract_details(soup):
    # wool-style.ru scatters plain text across many visually-identical
    # sibling ".str-bw_text" divs with no single wrapping description
    # container — one holds just the title (wrapped in <h3><b>...),
    # another (no <h3>) the real description (density, yarn, needle size,
    # skill level). Excluding any block that contains an <h3> is enough to
    # drop the title while keeping the rest — verified live: exactly one
    # non-<h3> block per product page, matching the real description.
    # Hidden slider-caption placeholder text ("Пример текста, который вы
    # можете написать" — leftover template boilerplate, inline
    # display:none) lives in a completely different class
    # (.strw-slider__caption), so it's excluded just by only looking at
    # .str-bw_text — no separate exclude step needed for it.
    texts = []
    for block in soup.select('.str-bw_text'):
        if block.find('h3'):
            continue
        text = block.get_text(separator='\n', strip=True)
        if text:
            texts.append(text)
    return '\n\n'.join(texts) or None

def _extract_romnastena_price(soup):
    # romnastena.com's own catalog (same site as the .product__text details
    # fallback) — single ".product__price" div, text is the bare number
    # followed by a sibling <span class="icon icon-rur"> (empty, no text
    # content, so get_text() already excludes it — no cleanup needed beyond
    # what _parse_woo_price does). No discount markup found on 10 real
    # product pages checked live — single-price only for now.
    price_el = soup.select_one('.product__price')
    if not price_el:
        return None, None
    return _parse_woo_price(price_el), None

def _extract_omalica_price(soup):
    # omalica.ru: Bitrix catalog.element component. The VISIBLE .price/
    # .old-price divs (id ending "_detail_price_value"/"_detail_oldprice_
    # value") are empty placeholders in a plain GET — Bitrix fills them via
    # JS from an inline AJAX-response string, confirmed empty (and
    # .old-price additionally carries a `hidden` class pre-JS even on a
    # page later shown WITH a discount) on 2 real product pages. But Bitrix
    # ALSO renders a static schema.org microdata span elsewhere on the page
    # for SEO — <span itemprop="price" content="1300">1 300</span>, a
    # SIBLING block (.desc-part inside .cart-info-block#main), not a
    # descendant of the visual price div — confirmed present and correct on
    # 3 live pages (850, 1300, 1300). No equivalent microdata exists for the
    # old/discounted price, so it's left unavailable here rather than
    # guessed at — not a bug, just what a plain GET can see on this
    # platform. Scoped to ".cart-info-block" (Bitrix's own product-detail
    # wrapper on this site) rather than a bare itemprop lookup, so a future
    # unrelated platform's own itemprop="price" usage elsewhere in the
    # chain can't collide with this.
    price_el = soup.select_one('.cart-info-block [itemprop="price"]')
    if not price_el or not price_el.has_attr('content'):
        return None, None
    try:
        return float(price_el['content']), None
    except (TypeError, ValueError):
        return None, None

def _extract_frog_price(soup):
    # ekaterinafrog.ru: a Tilda Zero Block (T396) plain text element with no
    # semantic price class at all — just a bare number+currency baked
    # straight into the design ("990р.", "1290р."). The block was
    # duplicated from a shared template across every product page rather
    # than rebuilt per page, so Tilda never regenerated its internal field
    # id — "tn_text_1770370854473000002" stays IDENTICAL everywhere,
    # confirmed live on 2 product pages (Base: 990, Zoe: 1290). Anchoring on
    # that exact id rather than a generic .tn-atom text-shape scan matters
    # here specifically: this is a knitting-pattern site, and "р." is also
    # the standard Russian abbreviation for "ряд" (row) in pattern
    # instructions, not just currency — a broad scan risks false-matching
    # stray "NN р." elsewhere in a description. No discount markup found —
    # single-price only for now.
    el = soup.select_one('[field="tn_text_1770370854473000002"]')
    if not el:
        return None, None
    m = re.match(r'(\d+)', el.get_text(strip=True))
    return (float(m.group(1)), None) if m else (None, None)

def _extract_frog_details(soup):
    # ekaterinafrog.ru: same Tilda Zero Block (T396) page as the price hook
    # above — crawlers.py's title-matching isolation only looks for
    # js-product/t-item/t754__product-full/t-popup classes, none of which
    # exist on this free-form canvas layout, and none of its fallback
    # selectors match either, so details came back empty for every product
    # on this domain (confirmed live: all 10 DB rows had NULL details).
    #
    # Originally anchored on the same stable price field id as
    # _extract_frog_price and walked up to its T396 ancestor — works for
    # paid patterns, but some products (e.g. mk_peach) are free "открытый
    # доступ" video master classes with no price markup on the page at all,
    # so that field doesn't exist there and the whole extraction came back
    # None. Every page has 2-3 T396 blocks total: a shared site-nav block
    # ("мастер-классы | магазин | отзывы | контакты") and, on single-mk
    # pages, a shared contact-footer block ("Есть вопрос? ...") — both
    # identical across every product page, unlike the actual product-info
    # block. Filtering those two out by their fixed opening text and taking
    # the longest survivor is robust whether or not a price field is
    # present, and matches (same result) on every page that DOES have one.
    blocks = soup.find_all(attrs={'data-record-type': '396'})
    candidates = []
    for b in blocks:
        text = b.get_text(separator='\n', strip=True)
        if not text or text.startswith(('мастер-классы', 'Есть вопрос')):
            continue
        candidates.append(text)
    if not candidates:
        return None
    return max(candidates, key=len)

_INSALES_HIDDEN_RE = re.compile(r'display\s*:\s*none', re.I)


def _insales_amount(el):
    # data-product-price несёт уже нормализованное число ("1700.0"), без
    # разделителя тысяч и валюты — это надёжнее видимого текста. Но атрибут
    # есть не на всех темах, поэтому текст остаётся запасным путём:
    # _parse_woo_price умеет и неразрывный пробел как разделитель тысяч
    # ("1\xa0700"), и приклеенный символ валюты.
    raw = el.get('data-product-price')
    if raw:
        try:
            return float(str(raw).replace(',', '.'))
        except ValueError:
            pass
    return _parse_woo_price(el)


def _extract_insales_price(soup):
    # InSales — платформа, а не один автор: разметка цены у неё общая
    # (.product-price-container + span.js-product-price[data-product-price],
    # <strike class="js-product-old-price-container"> со вложенным
    # .js-product-old-price), как WooCommerce и js-description выше по
    # цепочке. Та же платформа отдаёт и описание в .product-description
    # (см. список запасных селекторов в crawlers.py).
    #
    # Старая цена присутствует в DOM ВСЕГДА, независимо от того, активна ли
    # скидка: без скидки <strike> просто спрятан style="display: none", а
    # вложенный span пуст. Это ровно тот случай, про который предупреждает
    # DETAILS_PRICE_PARSING_PROCESS.md ("скрытые/задвоенные элементы"), —
    # поэтому две независимые проверки: (1) ни на самом элементе, ни на
    # предках до контейнера нет display:none / hidden; (2) число вообще
    # разобралось и оно БОЛЬШЕ текущей цены. Второе нужно на случай, если
    # тема оставит в спрятанном <strike> протухшее значение: "старая" цена
    # меньше или равная текущей — это не скидка, а мусор, и на фронте она
    # бы просто не отобразилась (скидка считается как oldPrice > price).
    container = soup.select_one('.product-price-container')
    if container is None:
        return None, None

    price_el = container.select_one('.js-product-price')
    if price_el is None:
        return None, None
    price = _insales_amount(price_el)
    if price is None:
        return None, None

    old_el = container.select_one('.js-product-old-price')
    if old_el is None:
        return price, None

    node = old_el
    while node is not None and node is not container.parent:
        if node.get('hidden') is not None or _INSALES_HIDDEN_RE.search(node.get('style') or ''):
            return price, None
        node = node.parent

    old_price = _insales_amount(old_el)
    if old_price is None or old_price <= price:
        return price, None
    return price, old_price


def _extract_julia_vyazget_price(soup):
    # juliavyazget.com: same "duplicated-template, stable internal field id"
    # situation as ekaterinafrog.ru above — a plain Tilda feature-list text
    # (".t1115__feature-descr") carrying the price as raw text ("790
    # рублей"), field id "li_descr__2828366988192" stable across pages
    # (confirmed on the one live product page checked: 790).
    el = soup.select_one('[field="li_descr__2828366988192"]')
    if not el:
        return None, None
    m = re.match(r'(\d+)', el.get_text(strip=True))
    return (float(m.group(1)), None) if m else (None, None)

def _parse_tilda_native_price(text):
    # Same numeric convention as Tilda Store's own JSON API (see
    # handlers.py's _parse_tilda_store_api_price) — comma is the DECIMAL
    # separator here (e.g. bayuma.ru's "400,00" = 400.00), not thousands
    # like WooCommerce's display strings. Duplicated in miniature rather
    # than imported from handlers.py, to keep hooks.py/handlers.py decoupled
    # (matches the existing module boundary — handlers.py has no
    # dependency on hooks.py and vice versa).
    if not text:
        return None
    try:
        return float(text.replace(',', '.').replace(' ', ''))
    except ValueError:
        return None

_TILDA_DONATE_NAME_RE = re.compile(r'^спасиб', re.IGNORECASE)

def _extract_tilda_gen_uid_price(soup, url, headers):
    # Some Tilda "t744"-family product pages (confirmed live on 3
    # elzestores.ru products — Emily_Sweater/Claire_Pulover/Noel_Sweater)
    # ship the .js-product-price element completely EMPTY in the static
    # HTML — no text, no data-product-price-def* attributes — unlike the
    # rest of that same site's products, which have the price baked in
    # server-side. tilda-catalog-1.1.min.js populates it client-side after
    # load via a POST to store.tildaapi.com/api/getproductsbyuid/, keyed by
    # the product's own data-product-gen-uid attribute (found via
    # get_screenshot/network trace, then confirmed by reading that script's
    # source directly). No storepartuid/recid needed here (unlike
    # handlers.py's _fetch_tilda_store_products) — this is a per-product
    # lookup, not a listing call. Origin/Referer must match the requesting
    # page's own domain or the API 404s with "Unknown domain" (verified
    # live) — it doesn't require a real session/cookie, just those headers.
    if url is None or headers is None:
        return None, None
    uid_el = soup.select_one('[data-product-gen-uid]')
    if not uid_el:
        return None, None
    uid = uid_el['data-product-gen-uid']
    origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    try:
        resp = requests.post(
            'https://store.tildaapi.com/api/getproductsbyuid/',
            data=json.dumps({'productsuid': [uid], 'c': int(time.time() * 1000)}),
            headers={**headers, 'Origin': origin, 'Referer': url, 'Content-Type': 'text/plain;charset=UTF-8'},
            timeout=10,
        )
        product = resp.json()['products'][0]
        current = _parse_tilda_native_price(product.get('price'))
        old = _parse_tilda_native_price(product.get('priceold'))
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
        return None, None
    return current, old

def _extract_tilda_store_popup_price(soup, url=None, headers=None):
    # A THIRD way Tilda Store markup gets exposed — in addition to the JSON
    # API (handlers.py's _parse_tilda_store_api_price, kitirrr.ru etc.) and
    # the old-style t754 hashroute layout (handlers.py's
    # _make_tilda_hashroute_store_handler) — confirmed live on
    # knitmode.ru, elzestores.ru, bayuma.ru (block "t744", class
    # ".js-store-prod-price-val"/"-old-val" — the exact markup the user
    # pasted from DevTools for Екатерина Кутушова/Лавкабулавка, both of
    # which go through the JSON API instead since they're SITE_HANDLERS)
    # AND on helenyakovleva.com (block "t780", the Cards widget, no
    # dedicated hook of its own before this) — different block numbers,
    # but ".js-product-price" is Tilda's own INTERNAL marker for "this is
    # the current price" shared across every block variant seen so far,
    # so anchoring on that instead of a block-specific class generalizes
    # for free to any other Tilda block number this platform hasn't hit
    # yet. Occasionally duplicated (helenyakovleva.com: 2 matches, one
    # per responsive breakpoint) but always with the SAME value in every
    # case checked — select_one's first match is safe.
    #
    # lenakotikova.ru reuses this same "t776" Store block/markers for an
    # unrelated tip-jar widget at the bottom of every pattern page — three
    # fixed "products" named "Спасибо!"/"СПАСИБО!"/"СПАСИБИЩЕ!" (100/300/
    # 500 руб "thank you" tiers), rendered before any real price element
    # would appear (there is none — these pages are genuinely free). A
    # blind select_one picked up the first donate tier (100) as if it were
    # the pattern's price. Skip any candidate whose sibling product-name
    # marker (.js-product-name, same Tilda-internal convention) starts
    # with "Спасиб" — text-based, not domain-gated, consistent with this
    # chain's design.
    cur_el = None
    for candidate in soup.select('.js-product-price'):
        card = candidate.find_parent(class_='js-product')
        name_el = card.select_one('.js-product-name') if card else None
        if name_el and _TILDA_DONATE_NAME_RE.match(name_el.get_text(strip=True)):
            continue
        cur_el = candidate
        break
    if not cur_el:
        return None, None
    current = _parse_tilda_native_price(cur_el.get_text(strip=True))
    # Old-price class names differ per block ("t744__price-value
    # js-store-prod-price-old-val" etc.) but this suffix is stable across
    # most of them. A FOURTH variant confirmed live on likavyazhi.ru's
    # standalone alias pages (block "t762", e.g. /bal_long_about) — no
    # "-old-val" class at all, just a plain field="price_old" attribute
    # (same stable-field-id convention already trusted in
    # _extract_julia_vyazget_price above) alongside field="price" on the
    # current-price element. Tried as a fallback, not primary, since the
    # class-based selector is more specific where it does apply.
    old_el = soup.select_one('[class*="price-old-val"]') or soup.select_one('[field="price_old"]')
    old = _parse_tilda_native_price(old_el.get_text(strip=True)) if old_el else None
    if current is None:
        # cur_el exists (a real, non-donate price element) but has no text —
        # the client-side-hydrated case, see _extract_tilda_gen_uid_price.
        current, old = _extract_tilda_gen_uid_price(soup, url, headers)
    if old == current:
        old = None
    return current, old

def _extract_vigbo_price(soup):
    # Vigbo (vigbo.com CDN) — a shared shop platform for handmade sellers,
    # confirmed live on nadin-shop.com, alyonashe.com, nastasiay.ru. Paid
    # items already match earlier in the chain via the rendered
    # product-price-discount/product-price-min DOM classes, but that
    # markup is OMITTED ENTIRELY for genuinely free (0 руб) items — the
    # theme simply doesn't render a price block when there's nothing to
    # charge, so every DOM-based mechanism correctly finds nothing even
    # though the item really is free, not broken ("не удалось извлечь
    # цену" was misclassifying confirmed-free items as extraction
    # failures). This reads the same data straight from the page's own
    # React hydration payload instead — <script id="shop-type"
    # data-type="products"> — which is present and correctly zeroed for
    # free items too. priceOrigin/priceWithDiscount already are exactly
    # "list price"/"price after any discount" (verified against a known
    # paid+discounted product: 850.00/550.00, matching what was already
    # correctly in the DB from a different mechanism) — same convention
    # every other hook in this chain returns.
    script = soup.find('script', id='shop-type', attrs={'data-type': 'products'})
    if not script or not script.string:
        return None, None
    try:
        product = json.loads(script.string)[0][0]
        current = float(product['priceWithDiscount'])
        original = float(product['priceOrigin'])
    except (ValueError, KeyError, IndexError, TypeError):
        return None, None
    if original == current:
        original = None
    return current, original

def extract_price_any_known_platform(soup, url=None, headers=None):
    # Single shared chain of every markup-shape-based (not domain-gated)
    # price mechanism implemented so far — WooCommerce, the js-description
    # platform, hollywool.ru's Bitrix widget, eiwi.ru, romnastena.com,
    # omalica.ru's Bitrix microdata, ekaterinafrog.ru/juliavyazget.com's
    # stable-field-id Tilda text blocks, InSales. Each one auto-detects via its own
    # selectors and returns (None, None) when its markup isn't present, so
    # trying them in sequence is safe/cheap on any page.
    #
    # Used by BOTH fetch_and_parse_detail (crawlers.py, during normal
    # novelty discovery) and check_price_updates.py (the daily re-check job
    # for already-published patterns) — one place to extend, in step with
    # DOMAIN_CRAWL_HOOKS growing, instead of two copies of this chain
    # drifting apart. No public function should reimplement this chain
    # directly.
    #
    # url/headers are optional and used by exactly one hook so far
    # (_extract_tilda_store_popup_price's client-side-hydrated-price
    # fallback, _extract_tilda_gen_uid_price) — every other hook in this
    # chain is still pure soup-in/price-out with no network I/O of its own.
    # Callers that don't have url/headers handy (none currently) simply
    # don't get that one fallback; every other mechanism is unaffected.
    price, old_price = _extract_woocommerce_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_js_description_platform_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_hollywool_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_eiwi_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_romnastena_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_wool_style_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_omalica_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_frog_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_julia_vyazget_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_insales_price(soup)
    if price is not None:
        return price, old_price
    price, old_price = _extract_tilda_store_popup_price(soup, url, headers)
    if price is not None:
        return price, old_price
    return _extract_vigbo_price(soup)

def _hollywool_exclude_details_paragraph(text):
    # Three boilerplate blocks repeated on every free-description product
    # page (verified live): (1) the "free with N skeins of yarn X/Y/Z"
    # condition — wording varies per product ("рекомендованной пряжи" vs a
    # named list "от 6 мотков пряжи Kremke Silky Kid...", and "мастер-класса"
    # sometimes inserted after "Бесплатное описание"), so matched on the two
    # stable substrings rather than the whole sentence; (2) the price-zeroes-
    # out-in-cart note; (3) the PDF-by-email delivery note (identical
    # wording confirmed on 2 live pages, unlike annetta-handmade.ru's
    # equivalent which needed a shorter marker after a live mismatch).
    return (
        ('Бесплатное описание' in text and 'доступно при покупке' in text)
        or 'автоматически обнулится' in text
        or 'будет отправлено на электронную почту в формате PDF' in text
    )

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

def _hollywool_extract_gallery(soup, raw_html=None, url=None):
    # Product detail pages carry their own gallery block
    # ("hw-lab-gallery" — a Bitrix-based custom theme), one <figure> per
    # photo with a data-hw-gallery-src on its <button>. The site's own
    # "is-primary" marker (fetchpriority="high"/current-photo-open) doesn't
    # always sit first in DOM order — confirmed on a real product page where
    # index 0 was primary but on others the primary can be elsewhere —
    # promote it to the front explicitly rather than trusting position.
    primary = None
    rest = []
    for fig in soup.select('.hw-lab-gallery__item'):
        btn = fig.find('button', class_='hw-lab-gallery__button')
        if not btn:
            continue
        src = btn.get('data-hw-gallery-src')
        if not src:
            continue
        if 'is-primary' in (fig.get('class') or []) and primary is None:
            primary = src
        else:
            rest.append(src)
    return ([primary] if primary else []) + rest

_EIWI_PRODUCT_ID_RE = re.compile(r'/(\d+)-[^/]+\.html')
_EIWI_STRING_TOKEN_RE = re.compile(r"^'([^']*)'$")

def _eiwi_extract_gallery(soup, raw_html, url):
    # eiwi.ru (a DLE/DataLife Engine site) only renders the FIRST gallery
    # photo server-side, as a <div>'s inline background-image style — the
    # rest exist only inside a page-embedded `var images = [...]` JS array
    # inside an `initShortGallery<productId>()` IIFE, populated client-side.
    # No DOM attribute/selector reaches it, so this regexes the raw HTML
    # (soup has already had <script> tags decomposed by the caller by the
    # time extract_gallery hooks run).
    #
    # Confirmed on a real product page that this SAME `var images = [...]`
    # pattern also appears for OTHER, unrelated products elsewhere on the
    # page (a "related items" widget reuses the identical gallery script) —
    # so this must anchor on the current product's own numeric id (parsed
    # from its URL, e.g. "13116" from ".../13116-romantika_top.html") via
    # `initShortGallery13116`, not just grab the first match on the page.
    id_match = _EIWI_PRODUCT_ID_RE.search(url or '')
    if not id_match:
        return []
    product_id = id_match.group(1)

    block_match = re.search(
        r'initShortGallery' + re.escape(product_id) + r'\s*\(\s*\)\s*\{.*?var\s+images\s*=\s*\[(.*?)\]',
        raw_html or '',
        re.S,
    )
    if not block_match:
        return []

    # Split on commas first (the array is always a flat list of string
    # literals, never nested) rather than a blind quote-to-quote regex —
    # with several adjacent empty '' entries (common: the JS pads the array
    # to a fixed size), a naive `'([^']+)'` findall bridges one empty pair's
    # closing quote to the next pair's opening quote and captures the
    # comma/whitespace between them as a phantom "URL".
    urls = []
    for token in block_match.group(1).split(','):
        token_match = _EIWI_STRING_TOKEN_RE.match(token.strip())
        if token_match and token_match.group(1).strip():
            urls.append(token_match.group(1))
    # The embedded array is thumbnail-sized ("/thumbs/<file>") — the same
    # filename one path segment up is the full-resolution original (verified
    # via HTTP: thumbs ~20-25KB, full ~150-225KB, both 200; og:image on the
    # page itself already points at the non-thumbs path).
    return [u.replace('/thumbs/', '/', 1) for u in urls]

def _juliavyazget_extract_gallery(soup, raw_html, url):
    # juliavyazget.com's product photo slider (.t-slds, meta[itemprop=image]
    # per slide — the exact markup _generic_extract_gallery's rule 5 already
    # handles) sits inside a literal <footer class="t-records"> on this
    # site's Tilda export — confirmed live (its LAST page block happens to
    # be exported with a <footer> tag, not the usual plain <div>; every
    # OTHER Tilda author checked here uses <div> throughout, zero <footer>
    # tags at all — this is this one site's export quirk, not a general
    # Tilda pattern, so it's not safe to stop decomposing <footer> globally).
    # fetch_and_parse_detail() already decomposed nav/header/footer/aside/
    # script/style/title on `soup` BEFORE calling this hook, which silently
    # deletes the gallery along with genuine boilerplate — re-parse from the
    # untouched raw_html instead and redo the same cleanup minus <footer>.
    fresh_soup = BeautifulSoup(raw_html or '', 'html.parser')
    for tag in fresh_soup(['nav', 'header', 'aside', 'script', 'style', 'title']):
        tag.decompose()
    for tag in fresh_soup.find_all(class_=re.compile(r'\brelated\b')):
        tag.decompose()
    return _generic_extract_gallery(fresh_soup)

def _elena_ianson_exclude_details_paragraph(text):
    # Standard boilerplate repeated verbatim at the end of every product
    # page (download-link delivery notice + "check your spam folder"
    # reminder) — not part of the product's own description. The container
    # has no <p> tags at all (see _extract_details_text's no-<p> branch),
    # so this runs against <br>-delimited lines instead of paragraphs; the
    # divider line ("___...") and the two notice sentences each land as
    # their own line, all three matched by the same marker substring.
    return 'Ссылка на скачивание файла придет' in text or 'внимательно заполняйте все поля' in text or set(text) == {'_'}

def _annetta_exclude_details_paragraph(text):
    # Standard boilerplate this author repeats verbatim on every product
    # page (delivery method / contact info / copyright notice) — not this
    # specific product's own description, so it shouldn't leak into
    # "Подробности". Matched by stable substrings rather than full-string
    # equality so minor per-product wording/formatting differences don't
    # slip the filter.
    markers = (
        # Delivery method — confirmed wording varies per-product ("на почту"
        # vs "на электронную почту" between two real products checked live),
        # so anchor on the part that's actually stable: "в формате pdf".
        'почту в формате pdf',
        'форму на сайте',
        'не дает вам права на его распространение',
    )
    return any(m in text for m in markers)

# Per-domain tweaks to the generic crawler's per-anchor product/pagination
# detection, keyed by a domain substring matched against site_url. Every hook
# is optional:
#   extra_product_class(a_classes) -> bool     additional signal an anchor is a product link
#   exclude_product(href)          -> bool     True to skip an otherwise-matched product anchor
#   exclude_pagination(next_url, is_category) -> bool   True to skip an otherwise-matched pagination/category link
#   extra_pagination_match(href)   -> bool     additional signal a link is a category/listing page to crawl
#   extra_valid_href_match(href)   -> bool     additional signal a link is itself a product page
#   extract_image(a)               -> str|None additional image lookup when the anchor itself has none
#   extract_gallery(detail_soup, raw_html, url) -> list[str] full product gallery from the detail page
#                                                (fetch_and_parse_detail already fetches this page for
#                                                density/yarn — no extra request; raw_html/url are the
#                                                pre-decompose page text and the product's own URL, for
#                                                hooks that need to regex embedded JS or disambiguate by id)
#   exclude_details_paragraph(text) -> bool     True to drop a <p> from "Подробности" — for boilerplate
#                                                (delivery method, contact info, copyright notices) an
#                                                author repeats verbatim on every product page; only
#                                                applies to details pulled from a matched container with
#                                                real <p> children (see _extract_details_text)
DOMAIN_CRAWL_HOOKS = {
    'annetta-handmade.ru': {
        'exclude_details_paragraph': _annetta_exclude_details_paragraph,
    },
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
        'extract_gallery': _hollywool_extract_gallery,
        'exclude_details_paragraph': _hollywool_exclude_details_paragraph,
    },
    'eiwi.ru': {
        'extract_gallery': _eiwi_extract_gallery,
    },
    'elena-ianson.ru': {
        'exclude_details_paragraph': _elena_ianson_exclude_details_paragraph,
    },
    'mustardyarn.ru': {
        'exclude_product': lambda href: 'opisanie' not in href,
        'exclude_pagination': lambda next_url, is_category: is_category and 'vse-opisanija' not in next_url,
    },
    # juliavyazget.com: "avtorskie_mk"/"free_mk" have no literal "/mk"
    # substring (has_valid_href/is_category require a slash right before
    # "mk") — the crawler never visits /avtorskie_mk at all, so it never
    # sees the 25 product links sitting there (confirmed live). free_mk's
    # own items all link out to t.me (Telegram posts, not real pages on
    # this domain) — the crawler's off-domain guard drops those before any
    # href-pattern check runs, so adding free_mk here wouldn't find
    # anything yet; deliberately left out until that's solved separately.
    'juliavyazget.com': {
        'extra_pagination_match': lambda href: bool(re.search(r'/avtorskie_mk/?$', href)),
        'extra_valid_href_match': lambda href: bool(re.search(r'/avtorskie_mk/[\w-]+', href)),
        'extract_gallery': _juliavyazget_extract_gallery,
    },
    # wool-style.ru: every product URL is a bare root-level slug
    # ("/detalis_casual", "/air_detalis", "/crystal_top" — no /shop/,
    # /catalog/, /product/ etc.), so the generic has_valid_href regex never
    # matches any of them. A handful of other root-level single-segment
    # links on the same listing page are NOT products (a policy draft, a
    # yarn-buying guide) — excluded explicitly by slug rather than by a
    # pattern, since nothing in the URL shape itself tells them apart from
    # real products.
    'wool-style.ru': {
        'extra_valid_href_match': lambda href: bool(re.match(r'^https?://[^/]+/[\w-]+/?$', href)),
        'exclude_product': lambda href: 'draft_1_politic' in href or 'gayd_pryazha' in href,
        'extract_details': _wool_style_extract_details,
        'extract_gallery': _wool_style_extract_gallery,
    },
    # ekaterinafrog.ru: see _extract_frog_details/_extract_frog_price above.
    'ekaterinafrog.ru': {
        'extract_details': _extract_frog_details,
    },
    # galasheikh.ru: see _extract_galasheikh_details above.
    'galasheikh.ru': {
        'extract_details': _extract_galasheikh_details,
    },
}

def _get_crawl_hooks(site_url):
    if not site_url:
        return {}
    for domain, hooks in DOMAIN_CRAWL_HOOKS.items():
        if domain in site_url:
            return hooks
    return {}
