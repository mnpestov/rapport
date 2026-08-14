#!/usr/bin/env python3
# Companion to backfill_detail_reencode.py — produces the artifacts needed
# to roll the reencoded images[]/imageUrl out to prod: two file lists
# (images/patterns vs uploads/patterns, same split as
# generate_prod_thumbnails_backfill.py) and a SQL file with UPDATE
# statements matched by Pattern.url.
#
# Unlike the thumbnailUrl rollout, this REPLACES what images[]/imageUrl
# point to, so each UPDATE carries a freshness guard: `AND images = <prod's
# CURRENT array>`, using a live read of prod taken right before generating
# this file (not Pattern.updatedAt, which raw psycopg2 writers elsewhere in
# this pipeline never bump — see PATTERN_IMAGES_BACKFILL_PROCESS.md). If a
# pattern's images[] changed on prod between this script running and the
# SQL actually being applied, that row's UPDATE becomes a silent no-op
# instead of clobbering a concurrent edit — the dry-run's "UPDATE 0" count
# for that row is the signal to re-run this generator and retry it.
#
# Deliberately does NOT touch prod's old original files — the SQL only
# repoints images[]/imageUrl at the new detail-tier files. The now-orphaned
# originals stay on prod's live disk (recoverable, no storage win yet);
# reclaiming that space is a separate, later cleanup pass once the rollout
# has proven stable, not part of this script.
#
# Usage: python3 generate_prod_detail_backfill.py <output_dir>
#   Requires prod read access via: ssh app@5.129.246.160
import json
import os
import subprocess
import sys
import tempfile

import psycopg2

PROD_SSH = "app@5.129.246.160"
PROD_DB_URL = "postgresql://kurgidb:kurgiDB12@127.0.0.1:5432/knitting_catalog"


def fetch_prod_patterns():
    # Query goes through a file (scp + psql -f), never inlined into an ssh
    # shell string — Pattern/imageUrl need double-quoted identifiers, which
    # collide with -c "..." wrapping and silently break under nested shell
    # quoting (the same class of bug that broke an earlier git commit in
    # this session's history).
    query = (
        'SELECT json_build_object(\'url\', url, \'images\', images, \'imageUrl\', "imageUrl") '
        'FROM "Pattern" WHERE images IS NOT NULL;'
    )
    with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", delete=False) as f:
        f.write(query)
        local_query_path = f.name

    remote_query_path = "/tmp/fetch_prod_patterns_query.sql"
    subprocess.run(["scp", local_query_path, f"{PROD_SSH}:{remote_query_path}"], check=True)
    os.unlink(local_query_path)

    result = subprocess.run(
        ["ssh", PROD_SSH, f"psql '{PROD_DB_URL}' -t -A -f {remote_query_path}"],
        capture_output=True, text=True, check=True,
    )
    subprocess.run(["ssh", PROD_SSH, f"rm -f {remote_query_path}"], check=True)

    prod_by_url = {}
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        prod_by_url[row["url"]] = row
    return prod_by_url


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 generate_prod_detail_backfill.py <output_dir>")
        sys.exit(1)
    output_dir = sys.argv[1]
    os.makedirs(output_dir, exist_ok=True)

    print("Fetching current prod Pattern.images/imageUrl (live read for freshness guard)...")
    prod_by_url = fetch_prod_patterns()
    print(f"  {len(prod_by_url)} pattern(s) on prod")

    db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/knitting_catalog")
    if "?" in db_url:
        db_url = db_url.split("?")[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()
    cursor.execute(
        'SELECT url, "imageUrl", images FROM "Pattern" WHERE images IS NOT NULL ORDER BY url'
    )
    local_patterns = cursor.fetchall()

    images_files = set()
    uploads_files = set()
    not_on_prod = []
    already_matches = 0
    sql_lines = [
        "-- Автосгенерировано generate_prod_detail_backfill.py.",
        "-- Переносит Pattern.images/imageUrl (detail-tier reencode, Phase 2b) с локальной dev БД на прод.",
        "-- Сопоставление по Pattern.url. Каждый UPDATE защищён guard'ом",
        "-- 'AND images = <текущий прод-массив>' — если картинки на проде",
        "-- поменялись после генерации этого файла, апдейт молча не сработает",
        "-- (UPDATE 0), это ожидаемо и безопасно, не ошибка.",
        "--",
        "-- ВАЖНО: сначала скопировать файлы из detail_files_images.txt в",
        "-- /var/www/rapport/apps/backend/public/images/patterns/ и из",
        "-- detail_files_uploads.txt в",
        "-- /var/www/rapport/apps/backend/uploads/patterns/ на проде,",
        "-- и только потом выполнять этот SQL. Старые оригиналы на проде",
        "-- этот SQL не трогает и не удаляет.",
        "",
        "BEGIN;",
        "",
    ]

    def basename_dir(rel_url):
        if rel_url.startswith("/uploads/patterns/"):
            return uploads_files
        return images_files

    for url, image_url, images in local_patterns:
        prod_row = prod_by_url.get(url)
        if prod_row is None:
            not_on_prod.append(url)
            continue
        if prod_row["images"] == list(images):
            already_matches += 1
            continue

        stmt = cursor.mogrify(
            'UPDATE "Pattern" SET images = %s, "imageUrl" = %s WHERE url = %s AND images = %s;',
            (images, image_url, url, prod_row["images"]),
        ).decode("utf-8")
        sql_lines.append(f"-- {url}")
        sql_lines.append(stmt)
        sql_lines.append("")

        for entry in images:
            basename_dir(entry).add(entry)

    sql_lines.append("COMMIT;")

    sql_path = os.path.join(output_dir, "prod_detail_backfill.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_lines) + "\n")

    images_files_path = os.path.join(output_dir, "detail_files_images.txt")
    with open(images_files_path, "w", encoding="utf-8") as f:
        for rel in sorted(images_files):
            f.write(os.path.basename(rel) + "\n")

    uploads_files_path = os.path.join(output_dir, "detail_files_uploads.txt")
    with open(uploads_files_path, "w", encoding="utf-8") as f:
        for rel in sorted(uploads_files):
            f.write(os.path.basename(rel) + "\n")

    to_update = len(local_patterns) - already_matches - len(not_on_prod)
    print(
        f"{len(local_patterns)} local pattern(s): {to_update} to update, "
        f"{already_matches} already match prod, {len(not_on_prod)} not found on prod"
    )
    print(f"Files: {len(images_files)} images/patterns, {len(uploads_files)} uploads/patterns")
    print(f"SQL:            {sql_path}")
    print(f"Images files:   {images_files_path}")
    print(f"Uploads files:  {uploads_files_path}")
    if not_on_prod:
        not_on_prod_path = os.path.join(output_dir, "not_on_prod.txt")
        with open(not_on_prod_path, "w", encoding="utf-8") as f:
            for u in not_on_prod:
                f.write(u + "\n")
        print(f"Not on prod:    {not_on_prod_path}")

    conn.close()


if __name__ == "__main__":
    main()
