import re
import urllib.parse


def get_base_url(u):
    return u[:-2] if u.endswith('-1') else u

_TPRODUCT_ID_RE = re.compile(r'^.*(/tproduct/)\d+-\d+-(.+)$')

def normalize_url(url):
    try:
        parsed = urllib.parse.urlparse(url.strip().lower())
        path = parsed.path.rstrip('/')
        if not path: path = '/'
        # Tilda "tproduct" URLs are shaped "<recid>-<productid>-<slug>" — recid
        # identifies the store section, slug is title-derived, but <productid>
        # is an internal Tilda id that churns whenever the site owner
        # re-creates/duplicates a product in their Store admin (confirmed on
        # lavkabulavka.com: same recid + slug, brand-new productid every
        # republish). Without stripping it, every republish normalizes to a
        # never-seen-before URL and dedup wrongly treats the exact same
        # product as a new "novelty". Sites whose tproduct URLs have no slug
        # at all (bysergeeva.ru, loonymax.tilda.ws: "<recid>-<productid>"
        # with nothing after) don't match this pattern and are untouched —
        # there's no stable identifier to fall back to for those.
        #
        # Everything before "/tproduct/" is discarded too (regex used to keep
        # it as part of group 1) — tsinbal.ru moved its store from
        # "/tproduct/..." to "/shop/tproduct/..." between crawls, and since
        # that prefix survived normalization unchanged, every already-synced
        # product got a different key than the freshly-scraped one and dedup
        # flagged all 47 existing patterns as new. The path prefix is a
        # site-structure detail Tilda can reshuffle anytime, not part of a
        # product's identity — recid+slug alone is stable across that.
        m = _TPRODUCT_ID_RE.match(path)
        if m:
            path = m.group(1) + m.group(2)
        result = f"{parsed.netloc}{path}"
        # WooCommerce на «простых» постоянных ссылках WordPress: товар живёт по
        # "/?product=<slug>", то есть его идентификатор — в строке запроса, а
        # путь у ВСЕХ товаров сайта одинаковый ("/"). Отбрасывая query целиком,
        # дедупликация схлопывала весь каталог в один ключ: на marinakilina.ru
        # краулер находил 42 товара, а «новым» считался ровно один. Берём
        # только сам параметр product, а не всю строку: utm-метки и прочий
        # мусор в ней не должны превращать один товар в два (живые примеры
        # таких url в базе есть — lavkabulavka.com, aggushop.tilda.ws).
        product_param = urllib.parse.parse_qs(parsed.query).get('product')
        if product_param:
            result += f"?product={product_param[0]}"
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


def normalize_free_price(price, old_price):
    # A price of exactly 0 means the item is genuinely free — verified live
    # multiple times this session (efgesha.ru's "0 pуб.", lavkabulavka.com's
    # "/bk", both confirmed as real 0-priced listings on their own pages,
    # not extraction glitches). Distinct from price being None (no price
    # markup found at all — an extraction gap, not a confirmed fact) — only
    # a CONFIRMED zero flips isFree; an unknown price never does. Nulls out
    # both price fields too — a free item has no price to show, so the
    # frontend's existing "isFree ? badge : price row" branching already
    # does the right thing without needing its own price===0 special case.
    if price == 0:
        return None, None, True
    return price, old_price, False

def _in_parens(text, pos):
    # True if `pos` sits inside an unclosed "(...)" span — a comma there is
    # listing multiple qualifiers for the SAME value ("Плотность (гладь,
    # узор): 28 п...", found on kitirrr.ru), not separating two different
    # clauses, so it must not be treated as a clause boundary.
    before = text[max(0, pos - 80):pos]
    after = text[pos:pos + 80]
    return (before.count('(') - before.count(')')) > 0 and (after.count(')') - after.count('(')) > 0

def _nearest_clause_boundary(text, region_start, region_end, from_right):
    # Nearest ,;. in text[region_start:region_end] that ISN'T inside parens
    # — from_right=True searches from the end backward (closest to
    # region_end, i.e. closest to a match that follows this region),
    # from_right=False searches from the start forward (closest to
    # region_start, i.e. closest to a match that precedes this region).
    #
    # A candidate only counts as a real clause boundary if the clause on
    # the FAR side of it (away from the match) itself states a number —
    # e.g. "Плотность в узоре: 42 п. ..., в лицевой глади: 31 п. ..."
    # (alenabarteneva.ru) has "31" right after the comma, a genuine second
    # density statement whose "в лицевой глади" qualifier must not leak
    # into the first match's context. But "Плотность 25п * 30 р - образец
    # 10x10 см, ажурная резинка" (kolechkoknit.ru) has no digit at all
    # after that same comma — "ажурная резинка" is still qualifying THIS
    # one density, not introducing another, so stopping there clipped the
    # ignore-word ("ажур") out of its own match's context, wrongly letting
    # an openwork-stitch gauge through as if it were plain стокинетт — a
    # real bug caught live comparing against the site's own stated stitch
    # pattern. Skip a digit-less candidate and keep looking outward instead
    # of stopping at the very first one.
    positions = [i for i in range(region_start, region_end) if text[i] in ',;.']
    if from_right:
        positions.reverse()
    for p in positions:
        if _in_parens(text, p):
            continue
        far_side = text[region_start:p] if from_right else text[p + 1:region_end]
        if re.search(r'\d', far_side):
            return p
    return -1


# eiwi.ru (DLE-платформа) иногда отдаёт валидную страницу товара — тот же
# 200, тот же полный HTML с ценой/описанием/галереей, — но с безусловным
# `location.href='...'` прямо в теле <script>, без обёртки в if/условие.
# requests/BeautifulSoup не выполняют JS, поэтому скрапер видит "нормальную"
# страницу товара, а реальный пользователь в браузере сразу же улетает на
# страницу автора (https://eiwi.ru/<автор>/) — товар для него недоступен.
# Найдено вручную на живых страницах (сентябрь 2026): 7604, 7608 у автора
# Knitwork_rnd редиректят, 7605 у того же автора — нет, значит это
# состояние КОНКРЕТНОГО товара (снят с продажи/удалён автором), а не всей
# площадки — нельзя просто забанить домен целиком.
#
# Сайт легитимно использует условный `location.href=` внутри onclick и
# внутри функций (например, ydalitSave — удаление товара автором, срабатывает
# только после AJAX-ответа) — те не должны матчиться, иначе распознавание
# ложно сработает почти на каждой странице eiwi.ru. Матчим ТОЛЬКО
# безусловный редирект: `location.href='...'` как первую непустую
# инструкцию внутри отдельного <script>...</script>, без предшествующего
# `if`/условия в том же теге.
def has_eiwi_forced_redirect(html):
    """
    True, если страница eiwi.ru содержит безусловный JS-редирект (товар
    снят с продажи автором на стороне площадки, ссылка ведёт в никуда для
    реального пользователя). Вызывающий код должен пропустить такой товар
    целиком — см. crawlers.py fetch_and_parse_detail и
    check_price_updates.py.

    Ищем <script> блок, где ПЕРВАЯ непустая строка — сам `location.href=`,
    без предшествующего `if`: страница из живого теста выглядела как
        <script>
           location.href='https://eiwi.ru/Knitwork_rnd/';
        </script>
    Дословный regex-поиск такой формы, а не общий "есть ли вообще
    location.href в скрипте" — иначе матчились бы и легитимные условные
    редиректы (внутри if/после AJAX), которых на площадке большинство.
    """
    if 'eiwi.ru' not in html.lower():
        return False
    for script_match in re.finditer(r'<script(?:\s[^>]*)?>(.*?)</script>', html, re.IGNORECASE | re.DOTALL):
        script_body = script_match.group(1)
        stripped = script_body.strip()
        if not stripped:
            continue
        first_statement = stripped.split('\n', 1)[0].strip()
        if re.match(r'^(?:window\.)?location\.href\s*=\s*[\'"]https?://eiwi\.ru/', first_statement, re.IGNORECASE):
            return True
    return False

