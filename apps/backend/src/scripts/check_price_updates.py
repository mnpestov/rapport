#!/usr/bin/env python3
# Отдельный от author_sync.py скрипт (сознательно не часть author_sync_lib
# как точка входа) — предназначен для автоматического запуска раз в сутки
# (cron на проде), проверяет АКТУАЛЬНОСТЬ Pattern.price/oldPrice/isFree у
# уже ОПУБЛИКОВАННЫХ паттернов авторов из CONFIRMED_AUTHORS
# (author_sync_lib/confirmed_authors.py — тот же список, что использует
# generate_prod_backfill_sql.py, чтобы два списка не расходились). Не
# трогает details, не создаёт новые паттерны, не взаимодействует с очередью
# модерации (AuthorSyncItem/AuthorSyncReport) — только перечитывает цену с
# реального сайта автора и обновляет её в БД, если она изменилась. Цена=0
# трактуется как "бесплатно" (см. normalize_free_price в utils.py) —
# price/oldPrice в этом случае обнуляются, isFree выставляется в true (но
# никогда не сбрасывается обратно в false, если уже true — это может быть
# ручное решение админа, не связанное с ценой).
#
# Список авторов растёт по мере прохождения новых в рамках итеративного
# процесса (см. DETAILS_PRICE_PARSING_PROCESS.md) — редактировать нужно
# только confirmed_authors.py, этот скрипт сам подбирает способ проверки:
#   - для авторов на SITE_HANDLERS/SUPPLEMENTAL_STORE_HANDLERS (Tilda Store —
#     JS-хydrated, обычный GET на Pattern.url ничего не покажет) — повторно
#     вызывает тот же store-хендлер, что и при обычном обходе/бэкфилле, и
#     сопоставляет по нормализованному url (см. sample_details/backfill_details
#     в main.py — тот же паттерн);
#   - для всех остальных — обычный GET + extract_price_any_known_platform
#     (author_sync_lib/hooks.py), общую цепочку всех платформенных
#     механизмов извлечения цены (WooCommerce, js-description, hollywool.ru,
#     eiwi.ru). Как только для нового автора появляется свой хук цены —
#     просто вписать эту функцию в цепочку внутри
#     extract_price_any_known_platform, и check_price_updates.py начинает её
#     использовать без единой правки в этом файле.
#
# Рекомендуемый cron на проде (не настраивается этим скриптом — только
# рекомендация, реальную установку делает пользователь при деплое):
#   0 4 * * * cd /var/www/rapport/apps/backend/src/scripts && python3 check_price_updates.py >> /var/log/rapport/price_check.log 2>&1
#
# CLI:
#   python3 check_price_updates.py                 # все CONFIRMED_AUTHORS
#   python3 check_price_updates.py "Имя автора"     # только один автор (ручная проверка)

import os
import sys
from datetime import datetime, timezone

import psycopg2
import requests
from bs4 import BeautifulSoup

from author_sync_lib.confirmed_authors import CONFIRMED_AUTHORS
from author_sync_lib.hooks import extract_price_any_known_platform
from author_sync_lib.handlers import SITE_HANDLERS, SUPPLEMENTAL_STORE_HANDLERS
from author_sync_lib.utils import normalize_url, get_base_url, normalize_free_price

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
}


def check_prices(target_author_name=None):
    db_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5434/knitting_catalog')
    if '?' in db_url:
        db_url = db_url.split('?')[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    authors_to_check = [target_author_name] if target_author_name else CONFIRMED_AUTHORS

    changes = []
    errors = []
    checked = 0

    for author_name in authors_to_check:
        cursor.execute('SELECT id, site FROM "Author" WHERE name = %s', (author_name,))
        row = cursor.fetchone()
        if not row:
            errors.append((author_name, None, "автор не найден в БД"))
            continue
        author_id, site = row

        # Только видимые (опубликованные) паттерны — черновики и очередь
        # модерации этот джоб не касается вообще.
        cursor.execute(
            'SELECT id, url, title, price, "oldPrice", "isFree" FROM "Pattern" '
            'WHERE "authorId" = %s AND "isVisible" = true AND url IS NOT NULL',
            (author_id,)
        )
        patterns = cursor.fetchall()
        if not patterns:
            continue

        # Tilda Store authors (SITE_HANDLERS/SUPPLEMENTAL_STORE_HANDLERS) are
        # JS-hydrated — a plain GET on Pattern.url never renders price (or,
        # for hash-routed sites, renders a page with EVERY product's price,
        # not just this one). A blind extract_price_any_known_platform(soup)
        # on such a page would silently return None and — worse — that None
        # would then look like "price genuinely disappeared" and overwrite a
        # correct value with NULL. Re-run the same store handler used during
        # discovery/backfill instead, once per author, and match by
        # normalized base URL — same pattern as sample_details/backfill_details.
        site_handler = None
        if site:
            for domain, handler in {**SITE_HANDLERS, **SUPPLEMENTAL_STORE_HANDLERS}.items():
                if domain in site:
                    site_handler = handler
                    break

        handler_items = None
        if site_handler:
            try:
                handler_items, _ = site_handler([], [], set(), HEADERS)
            except Exception as e:
                errors.append((author_name, None, f"store handler failed: {e}"))
                handler_items = []

        for pattern_id, url, title, db_price, db_old_price, db_is_free in patterns:
            checked += 1
            try:
                if handler_items is not None:
                    target_base = get_base_url(normalize_url(url))
                    match = next(
                        (it for it in handler_items if get_base_url(normalize_url(it['url'])) == target_base),
                        None
                    )
                    if match is None:
                        errors.append((author_name, url, "не найден в текущем ответе store handler (URL мог измениться)"))
                        continue
                    new_price, new_old_price = match.get('price'), match.get('oldPrice')
                else:
                    resp = requests.get(url, headers=HEADERS, timeout=10)
                    soup = BeautifulSoup(resp.text, 'html.parser')
                    new_price, new_old_price = extract_price_any_known_platform(soup)
            except Exception as e:
                errors.append((author_name, url, str(e)))
                continue

            # price = 0 means genuinely free (see normalize_free_price) —
            # only ever ADDS the flag, never removes an existing True (could
            # be a deliberate admin decision unrelated to price).
            new_price, new_old_price, new_is_free = normalize_free_price(new_price, new_old_price)
            new_is_free = new_is_free or db_is_free

            # DB даёт Decimal, extraction path — float; приводим обе стороны
            # к float, чтобы сравнение было однозначным.
            old_price_f = float(db_price) if db_price is not None else None
            old_old_price_f = float(db_old_price) if db_old_price is not None else None

            if new_price != old_price_f or new_old_price != old_old_price_f or new_is_free != db_is_free:
                cursor.execute(
                    'UPDATE "Pattern" SET price = %s, "oldPrice" = %s, "isFree" = %s WHERE id = %s',
                    (new_price, new_old_price, new_is_free, pattern_id)
                )
                conn.commit()
                changes.append((author_name, title, url, old_price_f, old_old_price_f, new_price, new_old_price))

    lines = [
        f"# Price check report — {datetime.now(timezone.utc).isoformat()}",
        "",
        f"Проверено паттернов: {checked}. Изменений: {len(changes)}. Ошибок: {len(errors)}.",
        "",
    ]
    if changes:
        lines.append("## Изменения цены")
        lines.append("| Автор | Товар | Ссылка | Было (цена/старая) | Стало (цена/старая) |")
        lines.append("|---|---|---|---|---|")
        for author_name, title, url, old_p, old_op, new_p, new_op in changes:
            title_safe = (title or '').replace('|', '\\|')
            lines.append(f"| {author_name} | {title_safe} | {url} | {old_p}/{old_op} | {new_p}/{new_op} |")
        lines.append("")
    if errors:
        lines.append("## Ошибки")
        lines.append("| Автор | Ссылка | Ошибка |")
        lines.append("|---|---|---|")
        for author_name, url, err in errors:
            lines.append(f"| {author_name} | {url or '—'} | {err} |")
        lines.append("")

    report_path = os.path.join(os.path.dirname(__file__), 'price_check_report.md')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"Проверено {checked} паттерн(ов), изменений: {len(changes)}, ошибок: {len(errors)}.")
    print(f"Отчёт: {report_path}")
    conn.close()
    return changes, errors


if __name__ == "__main__":
    target_arg = sys.argv[1] if len(sys.argv) > 1 else None
    check_prices(target_arg)
