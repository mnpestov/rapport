#!/usr/bin/env python3
# Companion to backfill_all_thumbnails.py — produces the two artifacts
# needed to roll the newly-generated thumbnailUrl values out to prod: a
# file list of the *-thumb.webp files (to rsync to prod's
# public/images/patterns/ BEFORE the SQL runs — files must land first or
# the site 404s on the new thumbnails) and a SQL file with UPDATE
# statements matched by Pattern.url (not id — same reasoning as
# generate_prod_images_backfill.py). Global — covers every pattern with a
# thumbnailUrl, not one author at a time. Writes only to the given output
# dir, never touches prod itself.
#
# Usage: DATABASE_URL=... python3 generate_prod_thumbnails_backfill.py <output_dir>
import os
import sys

import psycopg2


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 generate_prod_thumbnails_backfill.py <output_dir>")
        sys.exit(1)
    output_dir = sys.argv[1]
    os.makedirs(output_dir, exist_ok=True)

    db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/knitting_catalog")
    if "?" in db_url:
        db_url = db_url.split("?")[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    cursor.execute(
        'SELECT url, "thumbnailUrl" FROM "Pattern" WHERE "thumbnailUrl" IS NOT NULL ORDER BY url'
    )
    patterns = cursor.fetchall()

    # Two separate destination dirs on prod, same split as
    # imagePipeline.ts/local_path_for — scraper-derived covers land in
    # public/images/patterns/, admin-manual-upload covers in
    # uploads/patterns/. Keeping the file lists split avoids silently
    # rsync-ing an uploads/-sourced thumbnail into the wrong prod dir.
    images_files = set()
    uploads_files = set()
    sql_lines = [
        "-- Автосгенерировано generate_prod_thumbnails_backfill.py.",
        "-- Переносит Pattern.thumbnailUrl с локальной dev БД на прод.",
        "-- Сопоставление по Pattern.url (не id). Не трогает imageUrl/images.",
        "--",
        "-- ВАЖНО: сначала скопировать файлы из thumbnail_files_images.txt в",
        "-- /var/www/rapport/apps/backend/public/images/patterns/ и из",
        "-- thumbnail_files_uploads.txt в",
        "-- /var/www/rapport/apps/backend/uploads/patterns/ на проде,",
        "-- и только потом выполнять этот SQL.",
        "",
        "BEGIN;",
        "",
    ]

    for url, thumbnail_url in patterns:
        stmt = cursor.mogrify(
            'UPDATE "Pattern" SET "thumbnailUrl" = %s WHERE url = %s;',
            (thumbnail_url, url),
        ).decode("utf-8")
        sql_lines.append(stmt)
        if thumbnail_url.startswith("/uploads/patterns/"):
            uploads_files.add(thumbnail_url)
        else:
            images_files.add(thumbnail_url)

    sql_lines.append("")
    sql_lines.append("COMMIT;")

    sql_path = os.path.join(output_dir, "prod_thumbnails_backfill.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_lines) + "\n")

    images_files_path = os.path.join(output_dir, "thumbnail_files_images.txt")
    with open(images_files_path, "w", encoding="utf-8") as f:
        for rel in sorted(images_files):
            f.write(os.path.basename(rel) + "\n")

    uploads_files_path = os.path.join(output_dir, "thumbnail_files_uploads.txt")
    with open(uploads_files_path, "w", encoding="utf-8") as f:
        for rel in sorted(uploads_files):
            f.write(os.path.basename(rel) + "\n")

    total_files = len(images_files) + len(uploads_files)
    print(f"{len(patterns)} pattern(s), {total_files} unique thumbnail file(s) "
          f"({len(images_files)} images/patterns, {len(uploads_files)} uploads/patterns)")
    print(f"SQL:            {sql_path}")
    print(f"Images files:   {images_files_path}")
    print(f"Uploads files:  {uploads_files_path}")
    conn.close()


if __name__ == "__main__":
    main()
