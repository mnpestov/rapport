import os
import sys
import json
import psycopg2

from .utils import normalize_url, get_base_url, normalize_free_price
from .hooks import _get_crawl_hooks
from .handlers import SITE_HANDLERS, SUPPLEMENTAL_STORE_HANDLERS
from .crawlers import scrape_author_site, find_seed_url, fetch_and_parse_detail


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
            # Admin/author-cabinet forms cap the gallery at 5 photos (see
            # MAX_PATTERN_IMAGES in patternImages.ts) — clamp here too so a
            # freshly scraped draft never arrives with more than what can
            # actually be saved, rather than silently dropping the tail on
            # first edit.
            if isinstance(item.get('images'), list) and len(item['images']) > 5:
                item['images'] = item['images'][:5]
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
            if 'details' not in item:
                item['details'] = None
            if 'price' not in item:
                item['price'] = None
            if 'oldPrice' not in item:
                item['oldPrice'] = None
            item['price'], item['oldPrice'], item['isFree'] = normalize_free_price(item['price'], item['oldPrice'])
        
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

        # __file__ now lives one level deeper (author_sync_lib/) than the
        # original monolith did — go up one directory to keep writing this
        # report to the same apps/backend/src/scripts/ location as before.
        log_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'sync_stats.md')
        with open(log_path, 'w', encoding='utf-8') as f:
            f.write(md_content)

        print(f"\\nStats saved to {log_path}")

# ---------------------------------------------------------------------------
# --sample-details — read-only preview of the "Подробности" extraction (see
# fetch_and_parse_detail / _parse_tilda_store_product / the hashroute
# handler above) against ALREADY-PUBLISHED patterns, a couple per author.
# Writes NOTHING to the DB — this is step 1 of the backfill plan: review the
# table this produces, fix up extraction for whichever authors look wrong,
# THEN (separately, not implemented here yet) run a real backfill that
# writes Pattern.details for everyone.
# ---------------------------------------------------------------------------
def sample_details(samples_per_author=2):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
    }

    db_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5434/knitting_catalog')
    if '?' in db_url:
        db_url = db_url.split('?')[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, name, site FROM "Author"
        WHERE site IS NOT NULL
        AND site NOT LIKE '%t.me%'
        AND site NOT LIKE '%vk.com%'
        AND site NOT LIKE '%instagram.com%'
        ORDER BY name
    """)
    authors = cursor.fetchall()

    cursor.execute('SELECT id, label, "minValue", "maxValue" FROM "YarnRange" ORDER BY "minValue"')
    yarn_ranges_db = cursor.fetchall()
    cursor.execute('SELECT id, name FROM "Instrument"')
    instruments_db = cursor.fetchall()

    rows = []

    for author_id, author_name, site in authors:
        cursor.execute(
            'SELECT title, url FROM "Pattern" WHERE "authorId" = %s ORDER BY "createdAt" DESC LIMIT %s',
            (author_id, samples_per_author)
        )
        samples = cursor.fetchall()
        if not samples:
            continue

        print(f"--- {author_name} ({site}) ---")

        # SITE_HANDLERS authors don't expose a per-product page fetch at all
        # (that's the whole point of the handler — the generic crawler can't
        # see anything there) — re-run the SAME store-API handler used during
        # normal discovery and match by normalized base URL (handles Tilda's
        # volatile internal product id — see normalize_url/get_base_url,
        # same fix already shipped for the Lavkabulavka duplicate-novelty bug).
        # Checks SUPPLEMENTAL_STORE_HANDLERS too (not just SITE_HANDLERS) —
        # likavyazhi.ru only lives in the former (its patterns still get
        # discovered via the generic crawler too, unlike a true SITE_HANDLERS
        # bypass), but for re-deriving details/price on ALREADY-known
        # patterns the isolated per-product handler is strictly more
        # accurate than a plain page fetch would be.
        site_handler = None
        if site:
            for domain, handler in {**SITE_HANDLERS, **SUPPLEMENTAL_STORE_HANDLERS}.items():
                if domain in site:
                    site_handler = handler
                    break

        handler_items = None
        if site_handler:
            try:
                handler_items, _ = site_handler(yarn_ranges_db, instruments_db, set(), headers)
            except Exception as e:
                print(f"  Error running store handler: {e}")
                handler_items = []

        hooks = _get_crawl_hooks(site)

        for title, url in samples:
            details = None
            price = None
            old_price = None
            note = ''
            try:
                if handler_items is not None:
                    target_base = get_base_url(normalize_url(url))
                    match = next(
                        (it for it in handler_items if get_base_url(normalize_url(it['url'])) == target_base),
                        None
                    )
                    if match:
                        details = match.get('details')
                        # Tilda Store API handlers don't extract price/oldPrice
                        # yet (SITE_HANDLERS) — the API response has the fields
                        # (price/priceold), they're just not read out here yet.
                        price = match.get('price')
                        old_price = match.get('oldPrice')
                        note = 'store-api'
                    else:
                        note = 'not found in current store API response (URL may have changed)'
                else:
                    result = fetch_and_parse_detail({'url': url, 'title': title}, yarn_ranges_db, instruments_db, hooks)
                    details = result.get('details')
                    price = result.get('price')
                    old_price = result.get('oldPrice')
                    note = 'detail-page'
            except Exception as e:
                note = f'error: {e}'

            rows.append((author_name, title, url, details, price, old_price, note))

    md_lines = ["| Автор | Товар | Ссылка | Цена | Старая цена | Подробности (превью) | Заметка |", "|---|---|---|---|---|---|---|"]
    for author_name, title, url, details, price, old_price, note in rows:
        preview = (details or '—')[:150].replace('\n', ' ↵ ').replace('|', '\\|')
        title_safe = (title or '').replace('|', '\\|')
        price_safe = str(price) if price is not None else '—'
        old_price_safe = str(old_price) if old_price is not None else '—'
        md_lines.append(f"| {author_name} | {title_safe} | {url} | {price_safe} | {old_price_safe} | {preview} | {note} |")

    md_content = "\n".join(md_lines)
    log_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'sample_details.md')
    with open(log_path, 'w', encoding='utf-8') as f:
        f.write(md_content)

    empty_count = sum(1 for row in rows if not row[3])
    print(f"\nSampled {len(rows)} pattern(s) across {len(authors)} author(s). {empty_count} came back empty.")
    print(f"Table saved to {log_path}")
    conn.close()

# ---------------------------------------------------------------------------
# --backfill-details [author name] — writes details/price/oldPrice directly
# to already-published Pattern rows (WHERE details IS NULL OR price IS
# NULL, so it's safe to re-run — already-filled rows are skipped). Optional
# author name arg scopes it to one author, matching the per-author workflow
# in author_parsing_checklist.md; omitted runs every author with a site.
# Unlike main()'s "check for novelties" flow, this never touches
# AuthorSyncItem/moderation — details/price/oldPrice are purely additive
# fields on rows that already exist, nothing else about the pattern changes.
# ---------------------------------------------------------------------------
def backfill_details(target_author_name=None):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
    }

    db_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5434/knitting_catalog')
    if '?' in db_url:
        db_url = db_url.split('?')[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    if target_author_name:
        cursor.execute('SELECT id, name, site FROM "Author" WHERE name = %s', (target_author_name,))
    else:
        cursor.execute("""
            SELECT id, name, site FROM "Author"
            WHERE site IS NOT NULL
            AND site NOT LIKE '%t.me%'
            AND site NOT LIKE '%vk.com%'
            AND site NOT LIKE '%vk.ru%'
            AND site NOT LIKE '%instagram.com%'
            ORDER BY name
        """)
    authors = cursor.fetchall()
    if not authors:
        print(f"No author found matching {target_author_name!r}")
        conn.close()
        return

    cursor.execute('SELECT id, label, "minValue", "maxValue" FROM "YarnRange" ORDER BY "minValue"')
    yarn_ranges_db = cursor.fetchall()
    cursor.execute('SELECT id, name FROM "Instrument"')
    instruments_db = cursor.fetchall()

    total_updated = 0
    total_skipped = 0

    for author_id, author_name, site in authors:
        # price = 0 also needs a re-pass — it means the item is genuinely
        # free (see normalize_free_price) but predates that logic, so it's
        # still sitting there as a literal 0 instead of NULL+isFree=true.
        cursor.execute(
            'SELECT id, url, title, "isFree" FROM "Pattern" WHERE "authorId" = %s AND (details IS NULL OR price IS NULL OR price = 0)',
            (author_id,)
        )
        patterns = cursor.fetchall()
        if not patterns:
            continue

        print(f"--- {author_name}: {len(patterns)} pattern(s) to backfill ---")

        # A handler batch miss doesn't necessarily mean the page is
        # unparseable — some SITE_HANDLERS/SUPPLEMENTAL_STORE_HANDLERS
        # domains are Tilda "hashroute" stores (e.g. bysergeeva.ru,
        # likavyazhi.ru) that server-render every product on one page, so a
        # plain fetch_and_parse_detail on the individual Pattern.url ALSO
        # works — confirmed live for both. For the JSON-API-only domains
        # (kitirrr.ru, tsinbal.ru, etc.) a plain GET genuinely renders
        # nothing, but trying the fallback there is harmless — the chain
        # just returns (None, None) same as today, one extra wasted request,
        # no risk of wrong data. So: always fall back on a miss, don't try
        # to pre-classify which domains "deserve" it.
        site_handler = None
        if site:
            for domain, handler in {**SITE_HANDLERS, **SUPPLEMENTAL_STORE_HANDLERS}.items():
                if domain in site:
                    site_handler = handler
                    break

        handler_items = None
        if site_handler:
            try:
                handler_items, _ = site_handler(yarn_ranges_db, instruments_db, set(), headers)
            except Exception as e:
                print(f"  Error running store handler: {e}")
                handler_items = []

        hooks = _get_crawl_hooks(site)

        for pattern_id, url, title, db_is_free in patterns:
            try:
                match = None
                if handler_items is not None:
                    target_base = get_base_url(normalize_url(url))
                    match = next(
                        (it for it in handler_items if get_base_url(normalize_url(it['url'])) == target_base),
                        None
                    )

                if match:
                    details, price, old_price = match.get('details'), match.get('price'), match.get('oldPrice')
                else:
                    if handler_items is not None:
                        print(f"  not in current store API response, falling back to direct fetch: {url}")
                    result = fetch_and_parse_detail({'url': url, 'title': title}, yarn_ranges_db, instruments_db, hooks)
                    details, price, old_price = result.get('details'), result.get('price'), result.get('oldPrice')

                # Only ever ADD a free-flag derived from a confirmed price=0,
                # never remove one — an existing True could be a deliberate
                # admin decision unrelated to price, and this backfill has no
                # business reverting that.
                price, old_price, is_free = normalize_free_price(price, old_price)
                is_free = is_free or db_is_free

                cursor.execute(
                    'UPDATE "Pattern" SET details = %s, price = %s, "oldPrice" = %s, "isFree" = %s WHERE id = %s',
                    (details, price, old_price, is_free, pattern_id)
                )
                conn.commit()
                total_updated += 1
            except Exception as e:
                conn.rollback()
                print(f"  FAILED {url}: {e}")
                total_skipped += 1

    print(f"\nBackfill done: {total_updated} pattern(s) updated, {total_skipped} skipped/failed.")
    conn.close()

