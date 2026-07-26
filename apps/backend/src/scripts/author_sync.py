import psycopg2
import json
import urllib.parse
import os
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
        return f"{parsed.netloc}{path}"
    except:
        return url.strip().lower().rstrip('/')

def parse_yarn(text):
    results = []
    pattern1 = re.compile(r'(\d+)\s*м[а-я]*\s*(?:в|на|/|-)?\s*(\d+)\s*(?:г|g|гр)', re.IGNORECASE)
    pattern2 = re.compile(r'(\d+)\s*(?:г|g|гр)\s*(?:в|на|/|-)?\s*(\d+)\s*м[а-я]*', re.IGNORECASE)

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
    pattern = re.compile(r'(\d+(?:[.,]\d+)?)\s*(?:п\.?|пет[а-я]*|ст\.?|столб[а-я]*)(?:.{1,30}?)(\d+(?:[.,]\d+)?)\s*(?:р\.?|ряд[а-я]*)', re.IGNORECASE)
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
            
        return round(stitches), round(rows)
    return None, None

def fetch_and_parse_detail(p, yarn_ranges_db):
    try:
        detail_resp = requests.get(p['url'], headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}, timeout=10)
        detail_soup = BeautifulSoup(detail_resp.text, 'html.parser')
        
        # Cleanup visually noisy tags
        for tag in detail_soup(['nav', 'header', 'footer', 'aside', 'script', 'style']):
            tag.decompose()
            
        target_title = re.sub(r'[\W_]+', '', p['title'].lower())
        containers = detail_soup.find_all(class_=re.compile(r'js-product|t-item|t754__product-full|t-popup'))
        valid_texts = []
        
        for c in containers:
            c_text = c.get_text(separator=' ', strip=True)
            if target_title in re.sub(r'[\W_]+', '', c_text.lower()):
                valid_texts.append(c_text)
        
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
        return p
    except Exception as e:
        print(f"Error scraping detail {p['url']}: {e}")
        p['densityStitches'] = None
        p['densityRows'] = None
        p['yarnRanges'] = []
        return p

def scrape_author_site(site_url, yarn_ranges_db, all_existing_base_urls):
    # Basic crawler to extract pattern links and images, with simple pagination support
    items = []
    visited_pages = set()
    pages_to_visit = [site_url]
    product_links_dict = {}
    
    try:
        while pages_to_visit and len(visited_pages) < 5:
            current_url = pages_to_visit.pop(0)
            if current_url in visited_pages:
                continue
                
            visited_pages.add(current_url)
            
            try:
                resp = requests.get(current_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}, timeout=10)
                soup = BeautifulSoup(resp.text, 'html.parser')
                
                # Extract products
                for a in soup.find_all('a'):
                    href = a.get('href')
                    img = a.find('img')
                    if href and img:
                        alt = img.get('alt', '').strip()
                        src = img.get('data-src') or img.get('src')
                        # Note: added '/catalog/' to support Hollywool and similar sites better
                        if alt and src and ('/shop/' in href or '/tproduct/' in href or '/product/' in href or '/patterns/' in href or '/catalog/' in href):
                            if not href.startswith('http'):
                                href = urllib.parse.urljoin(site_url, href)
                            if not src.startswith('http'):
                                src = urllib.parse.urljoin(site_url, src)
                                
                            if href not in product_links_dict:
                                product_links_dict[href] = {
                                    'url': href,
                                    'imageUrl': src,
                                    'title': alt
                                }
                                
                # Extract pagination links
                for a in soup.find_all('a'):
                    href = a.get('href')
                    if href and re.search(r'page=|PAGEN_|[\?&]p=', href, re.I):
                        if not href.startswith('http'):
                            next_url = urllib.parse.urljoin(site_url, href)
                        else:
                            next_url = href
                            
                        # Only follow pagination on the same domain and path base
                        if next_url.startswith(site_url.split('?')[0]) and next_url not in visited_pages and next_url not in pages_to_visit:
                            pages_to_visit.append(next_url)
            except Exception as e:
                print(f"Error scraping page {current_url}: {e}")
                
        all_product_links = list(product_links_dict.values())
        
        # EARLIER DEDUPLICATION
        new_product_links = []
        for p in all_product_links:
            base_norm = get_base_url(normalize_url(p['url']))
            if base_norm not in all_existing_base_urls:
                new_product_links.append(p)
                all_existing_base_urls.add(base_norm) # Mark as seen to avoid duplicates within same run
                
        print(f"Found {len(all_product_links)} products on {site_url}. {len(new_product_links)} are completely new.")
        
        if not new_product_links:
            return []
            
        # ASYNCHRONOUS DEEP PARSE
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(fetch_and_parse_detail, p, yarn_ranges_db) for p in new_product_links]
            for future in concurrent.futures.as_completed(futures):
                parsed_p = future.result()
                items.append(parsed_p)
                
    except Exception as e:
        print(f"Error scraping {site_url}: {e}")
    return items

def main():
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

    cursor.execute("""
        SELECT id, site FROM "Author" 
        WHERE site IS NOT NULL 
        AND site NOT LIKE '%t.me%' 
        AND site NOT LIKE '%vk.com%'
        AND site NOT LIKE '%instagram.com%'
    """)
    
    authors = cursor.fetchall()
    
    # Fetch categories
    cursor.execute('SELECT id, name FROM "ProductType"')
    categories_db = cursor.fetchall()
    
    # Fetch YarnRanges
    cursor.execute('SELECT id, label, "minValue", "maxValue" FROM "YarnRange" ORDER BY "minValue"')
    yarn_ranges_db = cursor.fetchall()
    
    for author_id, site in authors:
        print(f"---")
        print(f"Processing {site}...")
        parsed_items = scrape_author_site(site, yarn_ranges_db, all_existing_base_urls)
        
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
                    cursor.execute("""
                        INSERT INTO "AuthorSyncItem" ("id", "reportId", "status", "url", "title", "parsedData")
                        VALUES (gen_random_uuid(), %s, 'PENDING', %s, %s, %s)
                        ON CONFLICT ("reportId", "url") DO NOTHING
                    """, (report_id, item['url'], item['title'], json.dumps(item)))
                
                conn.commit() 
                print(f"Saved {len(parsed_items)} new items for {site}")
            except Exception as e:
                conn.rollback()
                print(f"Failed to save {author_id}: {e}")
        else:
            print(f"No new items for {site}")

if __name__ == "__main__":
    main()
