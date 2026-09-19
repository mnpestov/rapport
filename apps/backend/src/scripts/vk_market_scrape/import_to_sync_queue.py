"""
Одноразовая загрузка товаров VK Market (items.json, собран build_dataset.py)
в очередь модерации «Елены Яковлевой вяжет» (authorId зафиксирован ниже —
Author.site уже указывает на этот же VK-маркет в БД).

Повторяет ТОТ ЖЕ SQL-паттерн, что и author_sync.py (main.py, строки ~284-301):
одна PENDING-строка AuthorSyncReport на автора + по одной AuthorSyncItem на
товар, с ON CONFLICT ("reportId", "url") DO NOTHING — безопасно перезапускать.
После этого товары штатно видны в админке → Авторы → карточка автора →
модалка новинок, как будто их нашёл сам скрапер (AUTHOR_IMPORT.md).

Фильтр перед загрузкой (по решению пользователя, 2026-09-19): только товары,
у которых в названии есть «МК» или «мастер-класс/мастер класс» — остальные 14
(наборы пряжи и несколько готовых изделий без пометки МК) сознательно не
попадают в очередь.

Категория (ProductType) — та же логика подбора по слову в названии, что и в
main.py (см. комментарий в коде), включая тот же баг с «головной убор» —
специально не исправлен здесь, чтобы поведение совпадало 1:1. Инструмент
(спицы/крючок) не определяется — в VK-описании его нет, дозаполняется вручную
при модерации, как и для любого другого автора с неполными данными.

Запуск (с сервера, где DATABASE_URL уже есть в окружении rapport-api):
    DATABASE_URL="postgresql://..." python3 import_to_sync_queue.py
    DATABASE_URL="postgresql://..." python3 import_to_sync_queue.py --dry-run
"""
import json
import os
import re
import sys
import unicodedata
import uuid
from pathlib import Path

import psycopg2

DIR = Path(__file__).parent
AUTHOR_ID = "76d0621f-74d0-4737-b77a-34fd3d022a96"  # "Елена Яковлева вяжет", site=vk.ru/yakovlevaelenaknit


def is_mk(title: str) -> bool:
    t = (title or "").lower()
    return t.startswith("мк") or "мастер-класс" in t or "мастер класс" in t


def strip_mk_prefix(title: str) -> str:
    """Убирает пометку МК/мастер-класс из названия перед сохранением в
    очередь — это была служебная метка VK-продавца для фильтрации на этом
    этапе (see is_mk), не часть реального названия описания."""
    t = title.strip()
    # "МК" в начале, включая варианты с двойным пробелом ("МК  пуловер") или
    # слэшем сразу после ("МК/кардиган" не встречается, но не полагаемся).
    t = re.sub(r"^мк\s+", "", t, flags=re.IGNORECASE)
    # "Мастер класс"/"Мастер-класс" в начале.
    t = re.sub(r"^мастер[\s-]?класс\s+", "", t, flags=re.IGNORECASE)
    return t.strip() or title.strip()


def match_categories(title: str, categories_db):
    """Портирована 1:1 из author_sync_lib/main.py (строки ~188-243) — то же
    прямое совпадение слова в названии + тот же словарь синонимов, включая
    известный баг с 'головной убор' (в БД категория называется 'шапка', так
    что это правило никогда не сработает — не исправляем, чтобы behaviour
    был идентичен обычному скрапу)."""
    title_lower = title.lower()
    matched = []
    for cat_id, cat_name in categories_db:
        if cat_name.lower() in title_lower:
            matched.append({"id": cat_id, "name": cat_name})

    if not matched:
        def pick(names):
            for cid, cname in categories_db:
                if cname.lower() in names:
                    matched.append({"id": cid, "name": cname})
                    return

        if any(w in title_lower for w in ["top", "топ", "футболка", "майка"]):
            pick(["топ"])
        elif any(w in title_lower for w in ["джемпер", "свитер", "пуловер", "sweater", "jumper"]):
            pick(["свитер", "джемпер"])
        elif any(w in title_lower for w in ["cardigan", "кардиган"]):
            pick(["кардиган"])
        elif any(w in title_lower for w in ["dress", "платье", "сарафан"]):
            pick(["платье"])
        elif any(w in title_lower for w in ["hat", "шапка", "чепчик", "берет", "beanie", "балаклава"]):
            pick(["головной убор"])
        elif any(w in title_lower for w in ["socks", "носки", "гольфы", "следки"]):
            pick(["носки"])
        elif any(w in title_lower for w in ["bag", "сумка", "шоппер", "авоська"]):
            pick(["сумка"])
        elif any(w in title_lower for w in ["vest", "жилет", "безрукавка"]):
            pick(["жилет"])

    seen = set()
    unique = []
    for c in matched:
        if c["id"] not in seen:
            unique.append(c)
            seen.add(c["id"])
    return unique


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    translit = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
    lowered = text.lower()
    out = "".join(translit.get(ch, ch) for ch in lowered)
    out = re.sub(r"[^a-z0-9]+", "-", out).strip("-")
    return out or "item"


def build_parsed_data(item: dict, categories_db, clean_title: str) -> dict:
    return {
        "url": item["market_url"],
        "images": item["photos"] or ([item["cover_photo"]] if item["cover_photo"] else []),
        "details": item.get("description"),
        "price": item.get("price_rub"),
        "oldPrice": None,
        "isFree": False,
        "isNew": True,
        "densityStitches": None,
        "densityRows": None,
        "categories": match_categories(clean_title, categories_db),
        "tags": [],
        "instruments": [],
        "yarnRanges": [],
        "yarns": [],
        "yarnMentions": [],
        "isMachineKnitting": False,
        # Только для справки в самой очереди — processSyncBatch это поле не читает.
        "vkItemId": item["id"],
        "sourceCategoryOnVk": item.get("category"),
    }


def main() -> None:
    dry_run = "--dry-run" in sys.argv

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL не задан в окружении.", file=sys.stderr)
        sys.exit(1)
    db_url = db_url.split("?")[0]

    with open(DIR / "items.json", encoding="utf-8") as f:
        items = json.load(f)

    filtered = [i for i in items if is_mk(i["title"])]
    print(f"Всего товаров в датасете: {len(items)}")
    print(f"Прошли фильтр «МК/мастер-класс»: {len(filtered)}")

    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        cur.execute('SELECT id, name FROM "ProductType"')
        categories_db = cur.fetchall()

        cur.execute('SELECT COUNT(*) FROM "Author" WHERE id = %s', (AUTHOR_ID,))
        if cur.fetchone()[0] == 0:
            print(f"Author {AUTHOR_ID} не найден в БД — проверь AUTHOR_ID в скрипте.", file=sys.stderr)
            sys.exit(1)

        if dry_run:
            print("\n--- DRY RUN: ничего не пишем в БД ---\n")
            for item in filtered:
                clean_title = strip_mk_prefix(item["title"])
                cats = match_categories(clean_title, categories_db)
                cat_names = ", ".join(c["name"] for c in cats) or "(не определена)"
                print(f"- {clean_title} | категория: {cat_names} | фото: {len(item['photos'])}")
            return

        cur.execute(
            """
            INSERT INTO "AuthorSyncReport" ("id", "authorId", "status", "updatedAt")
            VALUES (%s, %s, 'PENDING', now())
            ON CONFLICT ("authorId") WHERE status = 'PENDING' DO UPDATE SET "updatedAt" = now()
            RETURNING id
            """,
            (str(uuid.uuid4()), AUTHOR_ID),
        )
        report_id = cur.fetchone()[0]
        print(f"AuthorSyncReport id = {report_id}")

        inserted = 0
        for item in filtered:
            clean_title = strip_mk_prefix(item["title"])
            parsed_data = build_parsed_data(item, categories_db, clean_title)
            cur.execute(
                """
                INSERT INTO "AuthorSyncItem" ("id", "reportId", "status", "url", "title", "parsedData")
                VALUES (%s, %s, 'PENDING', %s, %s, %s)
                ON CONFLICT ("reportId", "url") DO NOTHING
                """,
                (
                    str(uuid.uuid4()),
                    report_id,
                    item["market_url"],
                    clean_title,
                    json.dumps(parsed_data, ensure_ascii=False),
                ),
            )
            inserted += cur.rowcount

        conn.commit()
        print(f"Вставлено новых позиций в очередь: {inserted} из {len(filtered)}")
        print("(разница — уже были в очереди при повторном запуске, это ожидаемо)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
