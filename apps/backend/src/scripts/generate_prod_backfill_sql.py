#!/usr/bin/env python3
# Генерирует SQL-файл, переносящий Pattern.details/price/oldPrice с
# ЛОКАЛЬНОЙ dev БД на прод — для авторов, уже пройденных в рамках
# итеративного процесса (см. author_parsing_checklist.md и
# DETAILS_PRICE_PARSING_PROCESS.md). Прод ещё не деплоился с этими
# изменениями, поэтому напрямую скопировать локальные данные нельзя — этот
# файл готовится заранее и выполняется на проде вручную ПОСЛЕ деплоя
# миграции и кода скрапера.
#
# Запускать заново (перегенерирует файл с нуля) каждый раз, когда в
# author_sync_lib/confirmed_authors.py добавляется новый автор — файл .sql
# руками не редактировать, список авторов теперь тоже не редактируется
# здесь напрямую (см. CONFIRMED_AUTHORS — тот же список использует и
# check_price_updates.py, единый источник правды).
#
# Сопоставление строк — по Pattern.url, а не id: id на локальной БД и на
# проде — разные записи (разные окружения), а url — это реальный внешний
# адрес товара на сайте автора, одинаковый в обеих базах, так как обе
# заполняются одним и тем же скрапером с одного и того же сайта. У url нет
# db-level UNIQUE constraint, но на практике дедупликация в author_sync.py
# (normalize_url/get_base_url) не допускает двух записей с одним url.
#
# ВАЖНО: перед выполнением этого файла на проде должна быть уже накатана
# миграция, добавляющая колонки details/price/oldPrice (prisma migrate
# deploy) — сам файл схему не трогает, только данные. Каждый UPDATE
# идемпотентен (безопасно выполнять повторно).

import os
import psycopg2

from author_sync_lib.confirmed_authors import CONFIRMED_AUTHORS as AUTHORS_DONE

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "prod_details_price_backfill.sql")


def main():
    db_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5434/knitting_catalog')
    if '?' in db_url:
        db_url = db_url.split('?')[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    lines = [
        "-- Автосгенерировано generate_prod_backfill_sql.py — руками не редактировать.",
        "-- Перегенерировать: DATABASE_URL=... python3 generate_prod_backfill_sql.py",
        "--",
        "-- Переносит Pattern.details/price/oldPrice с локальной dev БД на прод для",
        "-- уже пройденных авторов (см. author_parsing_checklist.md).",
        "-- Сопоставление по Pattern.url (не id — id на проде и локально разные).",
        "--",
        "-- ВАЖНО: сначала задеплоить миграцию (добавляет колонки details/price/",
        "-- oldPrice) и код скрапера, и только потом выполнять этот файл на проде.",
        "-- Каждый UPDATE идемпотентен — повторный запуск безопасен.",
        "",
        "BEGIN;",
        "",
    ]

    total_rows = 0
    for author_name in AUTHORS_DONE:
        cursor.execute('SELECT id FROM "Author" WHERE name = %s', (author_name,))
        row = cursor.fetchone()
        if not row:
            print(f"WARNING: автор не найден в локальной БД: {author_name!r} — пропущен")
            continue
        author_id = row[0]

        cursor.execute(
            'SELECT url, details, price, "oldPrice" FROM "Pattern" '
            'WHERE "authorId" = %s AND (details IS NOT NULL OR price IS NOT NULL) '
            'ORDER BY "createdAt"',
            (author_id,)
        )
        patterns = cursor.fetchall()
        if not patterns:
            print(f"WARNING: у {author_name!r} нет забэкфиленных паттернов локально — пропущен")
            continue

        lines.append(f"-- {author_name} ({len(patterns)} pattern(s))")
        for url, details, price, old_price in patterns:
            stmt = cursor.mogrify(
                'UPDATE "Pattern" SET details = %s, price = %s, "oldPrice" = %s WHERE url = %s;',
                (details, price, old_price, url)
            ).decode('utf-8')
            lines.append(stmt)
        lines.append("")
        total_rows += len(patterns)

    lines.append("COMMIT;")

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print(f"Записано {total_rows} UPDATE-выражений для {len(AUTHORS_DONE)} автор(ов) в {OUTPUT_PATH}")
    conn.close()


if __name__ == "__main__":
    main()
