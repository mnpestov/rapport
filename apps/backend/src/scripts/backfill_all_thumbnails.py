#!/usr/bin/env python3
# Phase 2a of the image-optimization plan: a global, safe sweep that fills
# Pattern.thumbnailUrl for every pattern that doesn't have one yet, using
# its existing images[0]/imageUrl as the source (same derivation as
# backfill_pattern_images.py's per-author retrofit, just run across ALL
# patterns instead of one curated author at a time). Never touches
# images[]/imageUrl — purely additive (new thumbnail file + one nullable
# column) — so unlike a full detail-tier reencode, this needs no original
# archival, freshness-check, or SSIM QA gate.
#
# Usage: DATABASE_URL=... python3 backfill_all_thumbnails.py
import os

import psycopg2

from backfill_pattern_images import generate_thumbnail_url


def main():
    db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/knitting_catalog")
    if "?" in db_url:
        db_url = db_url.split("?")[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    cursor.execute('''
        SELECT id, "imageUrl", images
        FROM "Pattern"
        WHERE "thumbnailUrl" IS NULL
        ORDER BY "createdAt"
    ''')
    rows = cursor.fetchall()
    print(f"{len(rows)} pattern(s) need thumbnailUrl")

    generated = 0
    no_source_url = 0
    no_source_file = []

    for pattern_id, image_url, images in rows:
        source = images[0] if images else image_url
        if not source:
            no_source_url += 1
            continue
        thumb = generate_thumbnail_url(source)
        if thumb is None:
            no_source_file.append((pattern_id, source))
            continue
        cursor.execute('UPDATE "Pattern" SET "thumbnailUrl" = %s WHERE id = %s', (thumb, pattern_id))
        conn.commit()
        generated += 1

    print(f"Done. generated={generated} no_source_url={no_source_url} no_source_file={len(no_source_file)} total={len(rows)}")
    if no_source_file:
        print("Patterns whose source image file is missing locally (need pulling from prod):")
        for pid, src in no_source_file[:50]:
            print(f"  {pid}  {src}")
        if len(no_source_file) > 50:
            print(f"  ... and {len(no_source_file) - 50} more")

    cursor.close()
    conn.close()


if __name__ == "__main__":
    main()
