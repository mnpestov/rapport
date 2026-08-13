#!/usr/bin/env python3
# Standalone gallery backfill for patterns that currently have only 1 photo.
# Does NOT touch author_sync_lib/main.py or the live "новинки" sync pipeline
# — read-only imports of its existing gallery-extraction building blocks
# (_generic_extract_gallery / DOMAIN_CRAWL_HOOKS extract_gallery), nothing in
# author_sync_lib is modified. LOCAL DB / LOCAL filesystem only — never
# touches prod.
#
# The existing cover photo (images[0]) is never re-downloaded or replaced —
# only NEW images are appended, up to MAX_IMAGES total, deduped by a
# perceptual hash (dHash) against the cover and against each other. Exact
# byte-hash dedup isn't enough here: CDNs (Vigbo, seen on iiaks.ru and
# staryxo-knit.com) commonly re-serve the SAME underlying photo at a
# different resolution/crop for the listing-card cover vs. the detail-page
# gallery — visually identical, byte-for-byte different. dHash is
# scale/compression-invariant, so it catches that case. Threshold=6
# calibrated live on real duplicate pairs here (distance 0-6) vs. genuinely
# different product photos (distance 22-37) and one unrelated false-positive
# class (an admin-uploaded screenshot standing in as a cover, distance 7-10
# against a real gallery photo — structurally similar by coincidence, not a
# duplicate) — 6 sits cleanly below both of those.
#
# Usage: DATABASE_URL=... python3 backfill_pattern_images.py "Author Name"
import hashlib
import json
import os
import re
import sys
import urllib.parse

import psycopg2
import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageOps
import io

sys.path.insert(0, os.path.dirname(__file__))
from author_sync_lib.hooks import _generic_extract_gallery, _get_crawl_hooks  # noqa: E402
from author_sync_lib.handlers import SITE_HANDLERS, SUPPLEMENTAL_STORE_HANDLERS
from author_sync_lib.utils import normalize_url

def _omalica_extract_gallery(soup, raw_html, url):
    return [a.get('href') for a in soup.select('a[data-gallery]') if a.get('href')]

def _tilda_extract_gallery(soup, raw_html, url):

    urls = []
    
    import re, json

    # 1. Isolate the specific product container if it's a Tilda hash-routed store page
    target_lid = None
    if '#!/tproduct/' in url:
        m = re.search(r'#!/tproduct/\d+-(\d+)', url)
        if m:
            target_lid = m.group(1)
            
    if target_lid:
        containers = soup.find_all(attrs={'data-product-lid': target_lid})
        if containers:
            # Scope all subsequent searches to just these product containers
            soup = BeautifulSoup("".join(str(c) for c in containers), 'html.parser')
    
    match = re.search(r'var\s+product\s*=\s*(\{.*?\});', raw_html, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            if 'gallery' in data:
                gallery_data = data['gallery']
                if isinstance(gallery_data, str):
                    gallery_data = json.loads(gallery_data)
                for item in gallery_data:
                    if item.get('img'):
                        urls.append(item['img'].replace('\/', '/'))
        except Exception as e:
            pass

    for gallery_elem in soup.select('[data-elem-type="gallery"][data-field-imgs-value]'):
        try:
            imgs_json = gallery_elem.get('data-field-imgs-value')
            if imgs_json:
                data = json.loads(imgs_json)
                for item in data:
                    if item.get('li_img'):
                        urls.append(item['li_img'])
        except:
            pass

    for container in soup.select('[class*="t-slds"]'):
        for img in container.select('img, meta[itemprop="image"]'):
            urls.append(img.get('data-src') or img.get('src') or img.get('content'))
        for bg in container.select('[data-original]'):
            urls.append(bg.get('data-original'))
            
    return [u for u in urls if u]

LOCAL_DOMAIN_CRAWL_HOOKS = {
    'omalica.ru': {
        'extract_gallery': _omalica_extract_gallery,
    },
    'privetpolinka.com': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'oviskoza.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'bayuma.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'anb-hook.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'ekaterinafrog.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'elzestores.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'lenakotikova.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'likavyazhi.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'lavkabulavka.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'viktoria-morozova.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'kitirrr.ru': {
        'extract_gallery': _tilda_extract_gallery,
    },
    'knitmode.ru': {
        'extract_gallery': _tilda_extract_gallery,
    }
}

def get_base_url(url: str) -> str:
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return parsed.netloc + parsed.path.rstrip('/')


MAX_IMAGES = 5
DHASH_SIZE = 8
DUPLICATE_THRESHOLD = 6
BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SCRAPER_IMAGES_DIR = os.path.join(BACKEND_ROOT, "public", "images", "patterns")
UPLOADS_IMAGES_DIR = os.path.join(BACKEND_ROOT, "uploads", "patterns")

# Same file the Node side (apps/backend/src/utils/imagePipeline.ts) reads —
# single source of truth for resize/quality/format so the two ingestion
# paths can't drift apart. See image-pipeline.config.json.
with open(os.path.join(BACKEND_ROOT, "image-pipeline.config.json"), encoding="utf-8") as _f:
    IMAGE_PIPELINE_CONFIG = json.load(_f)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}


def local_path_for(rel_url: str) -> str:
    if rel_url.startswith("/uploads/patterns/"):
        return os.path.join(UPLOADS_IMAGES_DIR, os.path.basename(rel_url))
    return os.path.join(SCRAPER_IMAGES_DIR, os.path.basename(rel_url))


def generate_thumbnail_url(cover_rel_url: str):
    # Mirrors apps/backend/src/utils/imagePipeline.ts's generateThumbnailUrl
    # exactly (same hash formula, same params source) — this is the only
    # producer that derives a thumbnail from an EXISTING cover already on
    # disk rather than a freshly downloaded one (this script never re-
    # downloads/replaces images[0] — see module docstring), so it's the one
    # place that can retroactively backfill thumbnailUrl for patterns that
    # already existed before this feature. Resilient by design: returns
    # None (never raises) on any failure, same contract as the TS version —
    # callers fall back to imageUrl.
    try:
        if cover_rel_url.startswith("/uploads/patterns/"):
            out_dir, prefix = UPLOADS_IMAGES_DIR, "/uploads/patterns/"
        else:
            out_dir, prefix = SCRAPER_IMAGES_DIR, "/images/patterns/"
        source_path = os.path.join(out_dir, os.path.basename(cover_rel_url))
        if not os.path.exists(source_path):
            return None

        with open(source_path, "rb") as f:
            source_bytes = f.read()

        cfg = IMAGE_PIPELINE_CONFIG["thumb"]
        max_dim, quality, fmt = cfg["maxDimension"], cfg["quality"], IMAGE_PIPELINE_CONFIG["format"]
        h = hashlib.sha256()
        h.update(source_bytes)
        h.update(f"|v{IMAGE_PIPELINE_CONFIG['version']}|thumb|{max_dim}|q{quality}|{fmt}".encode())
        filename = f"{h.hexdigest()[:16]}-thumb.{fmt}"
        output_path = os.path.join(out_dir, filename)

        if not os.path.exists(output_path):
            img = Image.open(io.BytesIO(source_bytes))
            img = ImageOps.exif_transpose(img)  # normalize EXIF orientation before resizing
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)  # in-place, preserves aspect, never upscales
            img.save(output_path, format="WEBP", quality=quality)

        return f"{prefix}{filename}"
    except Exception as e:
        print(f"    failed to generate thumbnail for {cover_rel_url}: {e}")
        return None


def dhash_of_bytes(data: bytes):
    try:
        img = Image.open(io.BytesIO(data)).convert("L").resize((DHASH_SIZE + 1, DHASH_SIZE), Image.LANCZOS)
    except Exception:
        return None
    pixels = list(img.getdata())
    bits = []
    for row in range(DHASH_SIZE):
        for col in range(DHASH_SIZE):
            left = pixels[row * (DHASH_SIZE + 1) + col]
            right = pixels[row * (DHASH_SIZE + 1) + col + 1]
            bits.append(1 if left < right else 0)
    return bits


def dhash_of_file(path: str):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return dhash_of_bytes(f.read())


def hamming(a, b) -> int:
    return sum(x != y for x, y in zip(a, b))


def is_duplicate(candidate_hash, seen_hashes) -> bool:
    if candidate_hash is None:
        return False
    return any(hamming(candidate_hash, h) <= DUPLICATE_THRESHOLD for h in seen_hashes if h is not None)


def fetch_gallery(url: str, hooks: dict, site: str = ""):
    resp = requests.get(url, headers=HEADERS, timeout=15)
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["nav", "header", "footer", "aside", "script", "style", "title"]):
        tag.decompose()
    for tag in soup.find_all(class_=re.compile(r"\brelated\b")):
        tag.decompose()

    local_hooks = {}
    for domain, h in LOCAL_DOMAIN_CRAWL_HOOKS.items():
            if (site and domain in site) or domain in url:
                local_hooks = h
                break

    gallery_hook = local_hooks.get("extract_gallery") or (hooks.get("extract_gallery") if hooks else None)
    gallery = (gallery_hook(soup, resp.text, url) if gallery_hook else None) or _generic_extract_gallery(soup)

    resolved = []
    for src in gallery:
        if src and not src.startswith("http"):
            src = urllib.parse.urljoin(url, src)
        if src:
            resolved.append(src)
    return resolved


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 backfill_pattern_images.py \"Author Name\"")
        sys.exit(1)
    author_name = sys.argv[1]

    db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/knitting_catalog")
    if "?" in db_url:
        db_url = db_url.split("?")[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    cursor.execute('SELECT id, site FROM "Author" WHERE name = %s', (author_name,))
    row = cursor.fetchone()
    if not row:
        print(f"Author not found: {author_name!r}")
        return
    author_id, site = row

    # Third OR-branch (thumbnailUrl IS NULL) is here only so a re-run on an
    # already-fully-processed author (5/5 images from before thumbnailUrl
    # existed) can retroactively backfill it — the gallery-topping-up logic
    # below is a no-op for those rows (len(new_images) > len(existing_images)
    # stays False), only the thumbnail backfill block actually does anything.
    cursor.execute(
        'SELECT id, url, slug, images, title, "thumbnailUrl" FROM "Pattern" '
        'WHERE "authorId" = %s AND (images IS NULL OR array_length(images, 1) <= 1 OR "thumbnailUrl" IS NULL) '
        'ORDER BY "createdAt"',
        (author_id,),
    )
    patterns = cursor.fetchall()
    print(f"{author_name}: {len(patterns)} pattern(s) to process (gallery and/or thumbnail)")

    hooks = _get_crawl_hooks(site)

    sample_url = patterns[0][1] if patterns else ""
    site_handler = None
    for domain, handler in {**SITE_HANDLERS, **SUPPLEMENTAL_STORE_HANDLERS}.items():
        if (site and domain in site) or (sample_url and domain in sample_url):
            site_handler = handler
            break

    handler_items = None
    if site_handler:
        try:
            handler_items, _ = site_handler([], [], set(), HEADERS)
            print(f"  Got {len(handler_items)} items from SITE_HANDLERS.")
        except Exception as e:
            print(f"  Error running store handler: {e}")
            handler_items = []

    updated = 0
    no_new = 0
    errors = 0

    thumbnails_generated = 0

    for pattern_id, url, slug, existing_images, title, thumbnail_url in patterns:
        existing_images = existing_images or []
        try:
            cover_hash = dhash_of_file(local_path_for(existing_images[0])) if existing_images else None

            # Backfills thumbnailUrl for patterns that already existed before
            # this feature — independent of whether a new gallery is found
            # below (this cover was never going to change either way), so
            # it's done unconditionally here rather than after the
            # early-continue "no gallery found" branch.
            if existing_images and not thumbnail_url:
                new_thumbnail_url = generate_thumbnail_url(existing_images[0])
                if new_thumbnail_url:
                    cursor.execute('UPDATE "Pattern" SET "thumbnailUrl" = %s WHERE id = %s', (new_thumbnail_url, pattern_id))
                    conn.commit()
                    thumbnails_generated += 1

            gallery = None
            if handler_items is not None:
                target_norm = normalize_url(url)
                target_base = get_base_url(target_norm)
                # Try exact match first (important for hash-routed SPAs)
                match = next(
                    (it for it in handler_items if normalize_url(it['url']) == target_norm),
                    None
                )
                if not match:
                    match = next(
                        (it for it in handler_items if get_base_url(normalize_url(it['url'])) == target_base),
                        None
                    )
                if not match and title:
                    match = next(
                        (it for it in handler_items if it.get('title') and it['title'].lower().strip() == title.lower().strip()),
                        None
                    )
                if match:
                    gallery = match.get('images', [])

            if not gallery:
                gallery = fetch_gallery(url, hooks, site)

            if not gallery:
                print(f"  no gallery found: {url}")
                no_new += 1
                continue

            new_images = list(existing_images)
            seen_hashes = [cover_hash] if cover_hash else []
            idx = len(existing_images) + 1

            for src in gallery:
                if len(new_images) >= MAX_IMAGES:
                    break
                try:
                    r = requests.get(src, headers=HEADERS, timeout=15)
                    r.raise_for_status()
                    ctype = r.headers.get("content-type", "")
                    if not ctype.startswith("image/"):
                        continue
                    content_hash = dhash_of_bytes(r.content)
                    if is_duplicate(content_hash, seen_hashes):
                        continue
                    seen_hashes.append(content_hash)

                    ext = os.path.splitext(urllib.parse.urlparse(src).path)[1] or ".jpg"
                    filename = f"{slug}-{idx}{ext}"
                    with open(os.path.join(SCRAPER_IMAGES_DIR, filename), "wb") as f:
                        f.write(r.content)
                    new_images.append(f"/images/patterns/{filename}")
                    idx += 1
                except Exception as e:
                    print(f"    failed to download {src}: {e}")
                    continue

            if len(new_images) > len(existing_images):
                cursor.execute('UPDATE "Pattern" SET images = %s WHERE id = %s', (new_images, pattern_id))
                conn.commit()
                updated += 1
                print(f"  {url}: {len(existing_images)} -> {len(new_images)} images")
            else:
                no_new += 1
                print(f"  {url}: no new unique images found")
        except Exception as e:
            errors += 1
            conn.rollback()
            print(f"  ERROR on {url}: {e}")

    print(f"\nDone. updated={updated} no_new={no_new} errors={errors} thumbnails_generated={thumbnails_generated} total={len(patterns)}")
    conn.close()


if __name__ == "__main__":
    main()
