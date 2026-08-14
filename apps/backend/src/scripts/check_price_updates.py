#!/usr/bin/env python3
# Отдельный от author_sync.py скрипт (сознательно не часть author_sync_lib
# как точка входа) — предназначен для автоматического запуска ДВАЖДЫ в
# сутки (через run_price_check.sh + cron на проде), проверяет АКТУАЛЬНОСТЬ
# Pattern.price/oldPrice/isFree у уже ОПУБЛИКОВАННЫХ паттернов авторов из
# CONFIRMED_AUTHORS (author_sync_lib/confirmed_authors.py — тот же список,
# что использует generate_prod_backfill_sql.py). Не трогает details, не
# создаёт новые паттерны, не взаимодействует с очередью модерации
# (AuthorSyncItem/AuthorSyncReport) — только перечитывает цену с реального
# сайта автора и обновляет её в БД, если она изменилась. Цена=0 трактуется
# как "бесплатно" (см. normalize_free_price в utils.py) — price/oldPrice в
# этом случае обнуляются, isFree выставляется в true (но никогда не
# сбрасывается обратно в false, если уже true).
#
# v2 (2026-08-13) — до этой версии скрипт ни разу не гонялся в масштабе
# (единственный прогон — 14 паттернов вручную), и был найден критический
# баг + несколько эксплуатационных дыр при подготовке к автозапуску. Пять
# safety-нетов:
#
#   1. Симметричная обработка "ничего не извлеклось". Для обычных
#      (не-Tilda-Store) авторов extract_price_any_known_platform
#      возвращает (None, None), когда ни один известный механизм не
#      подошёл (страница легла/CAPTCHA/редизайн — hooks.py "returns
#      (None, None) when its markup isn't present") — это НЕ исключение, и
#      без явной проверки такой результат тихо интерпретировался как "цена
#      пропала", записывая NULL в price/oldPrice в проде. Tilda Store-ветка
#      всегда имела такую защиту (if match is None: error, continue) —
#      теперь обе ветки симметричны: (None, None) = ошибка извлечения, БД
#      не трогаем.
#   2. conn.rollback() первой строкой в КАЖДОМ except (per-pattern и
#      per-author) — без него одна реальная ошибка записи оставляет
#      psycopg2-соединение в aborted-transaction state, и ВСЕ последующие
#      запросы на этом же (единственном на весь прогон) соединении
#      начинают падать с InFailedSqlTransaction.
#   3. Снапшот price/oldPrice/isFree перед КАЖДЫМ прогоном — ротация
#      последних SNAPSHOT_KEEP. Восстановление конкретных строк не требует
#      full DB restore из ночного pg_dump.
#   4. price_check_state.json — отдельный от markdown-отчёта источник
#      истины для подсчёта повторов ошибок. Эскалация в Telegram отдельным
#      сообщением, когда одна и та же пара автор+паттерн проваливается
#      ESCALATION_THRESHOLD прогонов подряд. Prune устаревших ключей —
#      только для авторов, чей author-level блок в этом прогоне отработал
#      без ошибки.
#   5. Разделение "куда идёт результат": каждый прогон, независимо от
#      исхода, пишется в PriceCheckRun (читает админка, вкладка
#      "Справочник") — это основной канал. Telegram — только когда
#      реально нужно вмешательство: errorsCount > 0 (лог ошибок) или
#      хроническая эскалация. Чистый прогон без ошибок в Telegram НЕ
#      шлётся вообще.
#
# v3 (2026-08-13) — по итогам первого полного прогона (74м35с на 84
# авторах) и решений пользователя:
#   - Cron дважды в сутки (3:00 и 15:00 МСК), не раз — см. cron ниже.
#     Имена снапшотов/датированных отчётов теперь включают время, не
#     только дату, иначе второй прогон того же дня перезаписывал бы
#     артефакты первого.
#   - Пауза между запросами снижена до 0.5с (решение пользователя, было
#     1с — консервативный дефолт до первого замера).
#   - Telegram-алерты идут одному конкретному человеку (не всем ADMIN и не
#     через отдельный PRICE_CHECK_BOT_TOKEN) — переиспользуется СУЩЕСТВУЮЩИЙ
#     BOT_TOKEN из apps/backend/.env (тот же бот, что и остальной
#     Telegram-функционал бэкенда — chatController.ts/whitelistController.ts)
#     и TELEGRAM_GATEWAY_BASE_URL (обязателен на проде — прямые запросы к
#     api.telegram.org ненадёжны с этого сервера, см.
#     services/loginCodeSender.ts: "to avoid ETIMEDOUT issues on the
#     production server"). Отдельный PRICE_CHECK_BOT_TOKEN из v2 был
#     ошибкой — не нужен, только дублировал уже существующую инфраструктуру.
#
# v4 (2026-08-14) — проверка "жива ли ссылка" переиспользует уже идущий на
#   каждый паттерн GET-запрос (отдельного прогона/крона для этого не
#   заводили): HTTP-статус >=400 или сетевая ошибка (DNS/таймаут/отказ в
#   соединении) поднимаются как ValueError с текстом "ссылка недоступна:
#   ...", ДО попытки извлечь цену — отдельно от "не удалось извлечь цену"
#   (та ошибка означает "страница жива, но разметка изменилась/не
#   распознана", это же — "страницы может не быть вовсе"). Дальше идёт по
#   тому же пути, что и любая другая ошибка: попадает в отчёт/Telegram
#   сразу, а через ESCALATION_THRESHOLD (3) прогонов подряд — в отдельное
#   хроническое уведомление. Разовые сетевые сбои сами не долетают до
#   алерта чаще, чем любая другая нестабильная ошибка сегодня.
#
# Список авторов растёт по мере прохождения новых в рамках итеративного
# процесса (см. DETAILS_PRICE_PARSING_PROCESS.md) — редактировать нужно
# только confirmed_authors.py; после каждого добавления автора нужен
# редеплой scripts/ на прод, иначе cron месяцами не увидит нового автора
# без единого сигнала об этом (см. DETAILS_PRICE_PARSING_PROCESS.md).
#
# CLI:
#   python3 check_price_updates.py                 # все CONFIRMED_AUTHORS
#   python3 check_price_updates.py "Автор 1" "Автор 2"  # только выбранные авторы (ручная проверка/кнопка в админке)
#
# Рекомендуемый cron на проде (не настраивается этим скриптом — только
# рекомендация, реальную установку делает пользователь при деплое):
#   0 3,15 * * * /var/www/rapport/apps/backend/src/scripts/run_price_check.sh >> /var/log/rapport/price_check.log 2>&1

import json
import os
import re
import sys
import time
import uuid
from datetime import date, datetime, timezone

import psycopg2
import requests
from psycopg2.extras import Json
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

SCRIPT_DIR = os.path.dirname(__file__)
SNAPSHOT_DIR = os.path.join(SCRIPT_DIR, "price_snapshots")
STATE_PATH = os.path.join(SCRIPT_DIR, "price_check_state.json")
# Двукратный прогон в сутки — вдвое больше файлов в день, держим примерно ту
# же глубину истории (~неделя), что и v2's SNAPSHOT_KEEP=7 при однократном.
SNAPSHOT_KEEP = 14
ESCALATION_THRESHOLD = 3
# Решение пользователя 2026-08-13 (было 1.0 — консервативный дефолт до
# первого замера; реальная средняя задержка сайтов оказалась ~0.73с).
REQUEST_PAUSE_SECONDS = 0.5
# Получатель Telegram-алертов — конкретный человек, не все ADMIN и не через
# отдельный бот-токен. Не секрет (обычный числовой Telegram user id,
# публично виден через @username) — хардкод, не .env.
ADMIN_TELEGRAM_ID = "505293788"  # @mnpestov
# Pattern.url иногда указывает на соцсеть/видео вместо реального магазина
# (например Алла Безгодова — часть паттернов ссылается на посты в t.me и
# видео на youtube.com) — такие адреса никогда не отдадут разметку с
# ценой, ежедневный GET по ним только впустую ждёт ConnectTimeout/
# ReadTimeout и засоряет отчёт "ошибками", которые на самом деле не
# ошибки извлечения, а в принципе не тот тип страницы. Пропускаются
# целиком — не считаются ни в checked, ни в errors. Тот же список
# доменов, что SOCIAL_SITE_PATTERN в syncController.ts (гейтит "Проверить
# новинки" для автора), плюс youtube.com/youtu.be — подтверждено живыми
# ошибками с этим доменом.
SOCIAL_URL_PATTERN = re.compile(r't\.me|vk\.com|instagram\.com|youtube\.com|youtu\.be', re.IGNORECASE)


def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_state(state):
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2, sort_keys=True)


def snapshot_current_prices(cursor, author_ids, run_stamp):
    if not author_ids:
        return None
    cursor.execute(
        'SELECT id, price, "oldPrice", "isFree" FROM "Pattern" '
        'WHERE "authorId" = ANY(%s) AND "isVisible" = true',
        (author_ids,)
    )
    rows = cursor.fetchall()
    snapshot = {
        str(pattern_id): {
            "price": float(price) if price is not None else None,
            "oldPrice": float(old_price) if old_price is not None else None,
            "isFree": is_free,
        }
        for pattern_id, price, old_price, is_free in rows
    }
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    path = os.path.join(SNAPSHOT_DIR, f"price_snapshot_{run_stamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False)

    existing = sorted(
        fn for fn in os.listdir(SNAPSHOT_DIR)
        if fn.startswith("price_snapshot_") and fn.endswith(".json")
    )
    for old_fn in existing[:-SNAPSHOT_KEEP]:
        os.remove(os.path.join(SNAPSHOT_DIR, old_fn))

    return path


def send_telegram_message(text):
    # Переиспользует СУЩЕСТВУЮЩИЙ BOT_TOKEN бэкенда (тот же бот, что
    # chatController.ts/whitelistController.ts) и TELEGRAM_GATEWAY_BASE_URL
    # — на проде прямые запросы к api.telegram.org ненадёжны (см.
    # services/loginCodeSender.ts), поэтому gateway — не опция, а
    # обязательное звено там, где он настроен; без него просто идёт
    # fallback на прямой адрес (для локальной разработки, где gateway не
    # настроен и не нужен). Своя ошибка тут не должна ронять весь прогон —
    # результат уже записан в PriceCheckRun к моменту вызова этой функции.
    bot_token = os.environ.get("BOT_TOKEN")
    if not bot_token:
        print(f"[telegram] BOT_TOKEN не задан, алерт пропущен:\n{text}")
        return
    gateway_base = os.environ.get("TELEGRAM_GATEWAY_BASE_URL") or "https://api.telegram.org"
    try:
        resp = requests.post(
            f"{gateway_base}/bot{bot_token}/sendMessage",
            json={"chat_id": ADMIN_TELEGRAM_ID, "text": text},
            timeout=10,
        )
        if resp.status_code != 200:
            print(f"[telegram] отправка не удалась: HTTP {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"[telegram] отправка не удалась: {e}")


def build_errors_message(checked, changed_count, errors):
    lines = [
        f"Price check: {len(errors)} ошибок из {checked} проверенных ({changed_count} изменений).",
        "",
    ]
    for author_name, title, url, err in errors[:15]:
        label = f"{author_name} — {title}" if title else author_name
        lines.append(f"  {label} {url or '—'}: {err}")
    if len(errors) > 15:
        lines.append(f"  ...и ещё {len(errors) - 15}")
    lines.append("")
    lines.append("Полная сводка (с гиперссылками на описания) — в админке, вкладка «Справочник».")
    return "\n".join(lines)


def build_escalation_message(escalations):
    lines = [f"⚠️ Price check — хронические ошибки ({ESCALATION_THRESHOLD}+ прогона подряд):"]
    for author_name, title, url, run_count in escalations[:10]:
        label = f"{author_name} — {title}" if title else author_name
        lines.append(f"  {label} {url} — {run_count} прогонов подряд")
    if len(escalations) > 10:
        lines.append(f"  ...и ещё {len(escalations) - 10}")
    return "\n".join(lines)


def save_run_to_db(cursor, conn, started_at, finished_at, checked, changes, errors, escalations):
    changes_json = [
        {
            "author": a, "title": t, "url": u,
            "oldPrice": op, "oldOldPrice": oop,
            "newPrice": np, "newOldPrice": nop,
        }
        for a, t, u, op, oop, np, nop in changes
    ]
    errors_json = [{"author": a, "title": t, "url": u, "error": e} for a, t, u, e in errors]
    escalations_json = [{"author": a, "title": t, "url": u, "runs": n} for a, t, u, n in escalations]

    cursor.execute(
        'INSERT INTO "PriceCheckRun" '
        '(id, "startedAt", "finishedAt", checked, changed, "errorsCount", changes, errors, escalations, "createdAt") '
        'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
        (
            str(uuid.uuid4()), started_at, finished_at, checked, len(changes), len(errors),
            Json(changes_json), Json(errors_json), Json(escalations_json),
            datetime.now(timezone.utc),
        )
    )
    conn.commit()


def check_prices(target_author_names=None):
    started_at = datetime.now(timezone.utc)
    run_stamp = started_at.strftime("%Y-%m-%d_%H%M")

    db_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5434/knitting_catalog')
    if '?' in db_url:
        db_url = db_url.split('?')[0]
    # Намеренно НЕ обёрнуто в try — полностью недоступная БД должна уронить
    # скрипт громко (ненулевой exit code), это и есть сигнал для
    # run_price_check.sh, что джоб упал целиком.
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    try:
        authors_to_check = target_author_names if target_author_names else CONFIRMED_AUTHORS

        cursor.execute('SELECT id FROM "Author" WHERE name = ANY(%s)', (authors_to_check,))
        author_ids = [row[0] for row in cursor.fetchall()]
        snapshot_path = snapshot_current_prices(cursor, author_ids, run_stamp)
        if snapshot_path:
            print(f"Снапшот: {snapshot_path}")

        state = load_state()
        today_iso = date.today().isoformat()

        changes = []
        errors = []
        checked = 0
        touched_keys = set()
        escalations = []

        for author_name in authors_to_check:
            try:
                cursor.execute('SELECT id, site FROM "Author" WHERE name = %s', (author_name,))
                row = cursor.fetchone()
                if not row:
                    errors.append((author_name, None, None, "автор не найден в БД"))
                    continue
                author_id, site = row

                cursor.execute(
                    'SELECT id, url, title, price, "oldPrice", "isFree" FROM "Pattern" '
                    'WHERE "authorId" = %s AND "isVisible" = true AND url IS NOT NULL',
                    (author_id,)
                )
                patterns = cursor.fetchall()

                site_handler = None
                if site:
                    for domain, handler in {**SITE_HANDLERS, **SUPPLEMENTAL_STORE_HANDLERS}.items():
                        if domain in site:
                            site_handler = handler
                            break

                handler_items = None
                if site_handler and patterns:
                    try:
                        handler_items, _ = site_handler([], [], set(), HEADERS)
                    except Exception as e:
                        errors.append((author_name, None, None, f"store handler failed: {e}"))
                        handler_items = []

                for pattern_id, url, title, db_price, db_old_price, db_is_free in patterns:
                    if SOCIAL_URL_PATTERN.search(url):
                        # Не считается ни проверкой, ни ошибкой — сознательно
                        # не трогаем touched_keys, чтобы prune ниже сам вычистил
                        # любую устаревшую запись эскалации по этой паре (тот
                        # же путь, что для паттерна, переставшего быть видимым).
                        continue

                    checked += 1
                    key = f"{author_name}::{url}"
                    touched_keys.add(key)
                    try:
                        matched_via_handler = False
                        if handler_items is not None:
                            target_base = get_base_url(normalize_url(url))
                            match = next(
                                (it for it in handler_items if get_base_url(normalize_url(it['url'])) == target_base),
                                None
                            )
                            if match is not None:
                                new_price, new_old_price = match.get('price'), match.get('oldPrice')
                                matched_via_handler = True

                        if not matched_via_handler:
                            # Либо автор вообще не на хендлере (обычная
                            # ветка), либо ЭТОТ конкретный паттерн — нет
                            # (гибридный автор: часть каталога на
                            # hash-route сторе, часть — отдельные алиас-
                            # страницы вне его, живой пример —
                            # likavyazhi.ru: /shop бьётся через хендлер,
                            # /bal_long_about и подобные — нет). Раньше
                            # второй случай был жёсткой ошибкой; теперь —
                            # обычный GET как fallback, тот же путь, что
                            # для не-хендлерных авторов.
                            try:
                                try:
                                    resp = requests.get(url, headers=HEADERS, timeout=10)
                                except requests.exceptions.RequestException as e:
                                    # Сеть/DNS/таймаут — сама страница могла
                                    # быть недоступна временно (см. итоговую
                                    # эскалацию ниже, тот же порог в 3
                                    # прогона подряд защищает от разовых
                                    # сбоев), но сигнал стоит зафиксировать
                                    # отдельно от "не смог распарсить цену".
                                    raise ValueError(f"ссылка недоступна: не удалось подключиться ({type(e).__name__})")
                                if resp.status_code >= 400:
                                    # Явный признак "автор поменял/убрал
                                    # ссылку" — отличаем текстом от обычной
                                    # ошибки извлечения цены ниже, чтобы в
                                    # отчёте/Телеграме это читалось как
                                    # отдельная категория, а не как "сайт
                                    # поменял вёрстку". Любой 4xx/5xx, не
                                    # только 404 — см. обсуждение с
                                    # пользователем.
                                    raise ValueError(f"ссылка недоступна: HTTP {resp.status_code}")
                                soup = BeautifulSoup(resp.text, 'html.parser')
                                new_price, new_old_price = extract_price_any_known_platform(soup, url, HEADERS)
                            finally:
                                # Пауза после КАЖДОЙ попытки запроса к сайту
                                # автора — успешной или нет — щадящий
                                # rate-limit, не только для happy path.
                                time.sleep(REQUEST_PAUSE_SECONDS)

                            if new_price is None and new_old_price is None and not (db_price is None and db_old_price is None):
                                # Симметрично матчингу хендлера выше:
                                # "ничего не извлеклось" — ошибка
                                # извлечения, а не подтверждённое "цены
                                # больше нет". См. безопасность №1 в
                                # докстринге модуля. НО: если в БД и так
                                # price/oldPrice уже NULL, терять нечего —
                                # это не регресс разметки, а страница, на
                                # которой цены в принципе никогда не было
                                # (пример: lenakotikova.ru — часть
                                # паттернов живёт на отдельных страницах вне
                                # магазина, без какой-либо ценовой разметки).
                                # Не поднимаем ошибку, ниже это естественно
                                # схлопнется в no-op (new==old==None) без
                                # записи в БД и без пометки как "изменение".
                                raise ValueError(
                                    "не удалось извлечь цену ни одним известным способом "
                                    "(разметка могла измениться)"
                                )

                        new_price, new_old_price, new_is_free = normalize_free_price(new_price, new_old_price)
                        new_is_free = new_is_free or db_is_free

                        old_price_f = float(db_price) if db_price is not None else None
                        old_old_price_f = float(db_old_price) if db_old_price is not None else None

                        if new_price != old_price_f or new_old_price != old_old_price_f or new_is_free != db_is_free:
                            cursor.execute(
                                'UPDATE "Pattern" SET price = %s, "oldPrice" = %s, "isFree" = %s WHERE id = %s',
                                (new_price, new_old_price, new_is_free, pattern_id)
                            )
                            conn.commit()
                            changes.append((author_name, title, url, old_price_f, old_old_price_f, new_price, new_old_price))

                        # Успех — сбрасываем прогресс эскалации для этой пары.
                        state.pop(key, None)

                    except Exception as e:
                        conn.rollback()
                        errors.append((author_name, title, url, str(e)))
                        entry = state.get(key)
                        if entry:
                            entry["consecutive_runs"] += 1
                        else:
                            entry = {"first_seen": today_iso, "consecutive_runs": 1}
                            state[key] = entry
                        if entry["consecutive_runs"] >= ESCALATION_THRESHOLD:
                            escalations.append((author_name, title, url, entry["consecutive_runs"]))
                        continue

                # Author-level блок отработал без исключения (даже если
                # patterns пуст) — можно доверять полученному списку и
                # чистить устаревшие ключи этого автора, которых не было
                # среди только что обработанных.
                prefix = f"{author_name}::"
                for existing_key in list(state.keys()):
                    if existing_key.startswith(prefix) and existing_key not in touched_keys:
                        del state[existing_key]

            except Exception as e:
                conn.rollback()
                errors.append((author_name, None, None, f"author-level failure: {e}"))
                # Сознательно НЕ трогаем state.json для этого автора —
                # неизвестно, какие из его паттернов сегодня были бы
                # реально сломаны, а какие прошли бы нормально. Прогресс
                # эскалации остаётся как есть до следующего нормального
                # прогона.
                continue

        save_state(state)
        finished_at = datetime.now(timezone.utc)

        lines = [
            f"# Price check report — {finished_at.isoformat()}",
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
            lines.append("| Автор | Название | Ссылка | Ошибка |")
            lines.append("|---|---|---|---|")
            for author_name, title, url, err in errors:
                title_safe = (title or '—').replace('|', '\\|')
                err_safe = (err or '').replace('|', '\\|')
                lines.append(f"| {author_name} | {title_safe} | {url or '—'} | {err_safe} |")
            lines.append("")
        if escalations:
            lines.append(f"## Хронические ошибки ({ESCALATION_THRESHOLD}+ прогона подряд)")
            lines.append("| Автор | Название | Ссылка | Прогонов подряд |")
            lines.append("|---|---|---|---|")
            for author_name, title, url, run_count in escalations:
                title_safe = (title or '—').replace('|', '\\|')
                lines.append(f"| {author_name} | {title_safe} | {url} | {run_count} |")
            lines.append("")

        report_text = '\n'.join(lines)
        report_path = os.path.join(SCRIPT_DIR, 'price_check_report.md')
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(report_text)
        dated_report_path = os.path.join(SCRIPT_DIR, f'price_check_report_{run_stamp}.md')
        with open(dated_report_path, 'w', encoding='utf-8') as f:
            f.write(report_text)

        # Основной канал результата — таблица для админки, независимо от
        # исхода. Telegram — только когда есть на что реагировать.
        save_run_to_db(cursor, conn, started_at, finished_at, checked, changes, errors, escalations)

        if errors:
            send_telegram_message(build_errors_message(checked, len(changes), errors))
        if escalations:
            send_telegram_message(build_escalation_message(escalations))

        print(f"Проверено {checked} паттерн(ов), изменений: {len(changes)}, ошибок: {len(errors)}.")
        print(f"Отчёт: {report_path}")
        return changes, errors
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    # Каждый argv — отдельное имя автора (не через запятую — имена сами
    # могут содержать что угодно, argv уже разделены оболочкой/spawn'ом
    # корректно). Без аргументов — все CONFIRMED_AUTHORS, как раньше.
    target_args = sys.argv[1:] if len(sys.argv) > 1 else None
    check_prices(target_args)
