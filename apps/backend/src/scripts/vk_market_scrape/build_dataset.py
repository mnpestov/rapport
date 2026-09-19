"""
Одноразовый сборщик товаров VK Market группы «Елена Яковлева вяжет»
(vk.ru/yakovlevaelenaknit, community id 211626529).

Источник данных — три HAR-снятых JSON-ответа VK API (market.get / batch.call),
полученных из браузерной сессии пользователя (публичные данные страницы
маркета, без токенов и авторизации). Здесь только парсинг уже сохранённых
файлов в чистый датасет — сетевых запросов этот скрипт не делает.

Вход: raw_response_0.json (batch.call, id=3p — items), raw_response_5.json,
raw_response_6.json (прямые market.get) — все три уже лежат в этой папке.

Выход: items.json (полный датасет) и items.csv (обзорная таблица).
"""
import json
import csv
from pathlib import Path
from typing import List, Dict, Optional

DIR = Path(__file__).parent


def load_items(path: Path, from_batch: bool = False) -> List[Dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if from_batch:
        for r in data["responses"]:
            body = r.get("body", {}).get("response", {})
            if isinstance(body, dict) and "items" in body:
                return body["items"]
        return []
    return data["response"]["items"]


def best_photo(item: dict) -> Optional[str]:
    thumb = item.get("thumb") or []
    if not thumb:
        return None
    # thumb — список размеров одного и того же фото по возрастанию; последний
    # самый крупный.
    return thumb[-1]["url"]


def all_photos(item: dict) -> List[str]:
    # thumbs — список ракурсов, каждый в виде своего списка размеров; берём
    # самый крупный размер каждого ракурса.
    thumbs = item.get("thumbs") or []
    urls = []
    for sizes in thumbs:
        if sizes:
            urls.append(sizes[-1]["url"])
    if not urls:
        single = best_photo(item)
        if single:
            urls = [single]
    return urls


def simplify(item: dict) -> dict:
    price = item.get("price") or {}
    category = item.get("category") or {}
    rating = item.get("item_rating") or {}
    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "description": item.get("description"),
        "price_rub": int(price.get("amount", 0)) / 100 if price.get("amount") else None,
        "price_text": price.get("text"),
        "category": category.get("name"),
        "availability": item.get("availability"),
        "rating": rating.get("rating"),
        "reviews_count": rating.get("reviews_count"),
        "market_url": item.get("market_url"),
        "seo_slug": item.get("seo_slug"),
        "cover_photo": best_photo(item),
        "photos": all_photos(item),
    }


def main() -> None:
    items0 = load_items(DIR / "raw_response_0.json", from_batch=True)
    items5 = load_items(DIR / "raw_response_5.json")
    items6 = load_items(DIR / "raw_response_6.json")

    all_items = items0 + items5 + items6
    seen_ids = set()
    deduped = []
    for item in all_items:
        if item["id"] in seen_ids:
            continue
        seen_ids.add(item["id"])
        deduped.append(item)

    simplified = [simplify(i) for i in deduped]
    simplified.sort(key=lambda x: x["id"])

    out_json = DIR / "items.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(simplified, f, ensure_ascii=False, indent=2)

    out_csv = DIR / "items.csv"
    with open(out_csv, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "title", "price_rub", "category", "rating", "reviews_count", "market_url", "cover_photo"])
        for i in simplified:
            writer.writerow([i["id"], i["title"], i["price_rub"], i["category"], i["rating"], i["reviews_count"], i["market_url"], i["cover_photo"]])

    print(f"Собрано товаров: {len(simplified)}")
    print(f"JSON: {out_json}")
    print(f"CSV:  {out_csv}")


if __name__ == "__main__":
    main()
