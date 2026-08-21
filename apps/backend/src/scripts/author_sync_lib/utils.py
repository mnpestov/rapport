import re
import urllib.parse


def get_base_url(u):
    return u[:-2] if u.endswith('-1') else u

_TPRODUCT_ID_RE = re.compile(r'^(.*/tproduct/)\d+-\d+-(.+)$')

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
        m = _TPRODUCT_ID_RE.match(path)
        if m:
            path = m.group(1) + m.group(2)
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

