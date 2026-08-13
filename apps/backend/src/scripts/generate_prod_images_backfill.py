#!/usr/bin/env python3
# Companion to backfill_pattern_images.py — for one already-verified author,
# produces the two artifacts needed to roll the new gallery photos out to
# prod: a file list of the NEWLY downloaded images (to rsync/scp to prod's
# public/images/patterns/ BEFORE the SQL runs — files must land first or the
# site 404s on the new gallery entries) and a SQL file with UPDATE
# statements matched by Pattern.url (not id — same reasoning as
# generate_prod_backfill_sql.py). Writes only to the scratchpad, never
# touches prod itself.
#
# Usage: DATABASE_URL=... python3 generate_prod_images_backfill.py "Author Name" <output_dir>
import os
import sys

import psycopg2

SCRAPER_IMAGES_PREFIX = "/images/patterns/"


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 generate_prod_images_backfill.py \"Author Name\" <output_dir>")
        sys.exit(1)
    author_name = sys.argv[1]
    output_dir = sys.argv[2]
    os.makedirs(output_dir, exist_ok=True)

    db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/knitting_catalog")
    if "?" in db_url:
        db_url = db_url.split("?")[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    cursor.execute('SELECT id FROM "Author" WHERE name = %s', (author_name,))
    row = cursor.fetchone()
    if not row:
        print(f"Author not found: {author_name!r}")
        sys.exit(1)
    author_id = row[0]

    cursor.execute(
        'SELECT url, images FROM "Pattern" WHERE "authorId" = %s AND images IS NOT NULL ORDER BY url',
        (author_id,),
    )
    patterns = cursor.fetchall()

    new_files = []
    sql_lines = [
        f"-- Автосгенерировано generate_prod_images_backfill.py для автора {author_name!r}.",
        "-- Переносит Pattern.images (галерея фото) с локальной dev БД на прод.",
        "-- Сопоставление по Pattern.url (не id).",
        "--",
        "-- ВАЖНО: сначала скопировать файлы из new_images_files.txt в",
        "-- /var/www/rapport/apps/backend/public/images/patterns/ на проде,",
        "-- и только потом выполнять этот SQL.",
        "",
        "BEGIN;",
        "",
    ]

    for url, images in patterns:
        images = images or []
        sql_lines.append(f"-- {url} ({len(images)} photo(s))")
        stmt = cursor.mogrify(
            'UPDATE "Pattern" SET images = %s, "imageUrl" = %s WHERE url = %s;',
            (images, images[0], url),
        ).decode("utf-8")
        sql_lines.append(stmt)
        sql_lines.append("")
        # Cover (images[0]) already exists on prod from before — only the
        # rest are new downloads that need to be shipped over.
        new_files.extend(images[1:])

    sql_lines.append("COMMIT;")

    sql_path = os.path.join(output_dir, "prod_images_backfill.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_lines) + "\n")

    files_path = os.path.join(output_dir, "new_images_files.txt")
    with open(files_path, "w", encoding="utf-8") as f:
        for rel in new_files:
            f.write(os.path.basename(rel) + "\n")

    print(f"{len(patterns)} pattern(s), {len(new_files)} new file(s)")
    print(f"SQL:   {sql_path}")
    print(f"Files: {files_path}")
    conn.close()


if __name__ == "__main__":
    main()
