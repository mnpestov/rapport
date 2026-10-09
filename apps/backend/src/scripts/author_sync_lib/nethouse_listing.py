# Цены Nethouse-магазинов (vigbo) списком со страниц каталога — только для
# check_price_updates.py. Вместо одного GET на каждый паттерн (~70 на автора)
# достаточно 1-5 запросов на магазин: карточки <a class="product"> на /shop,
# /shop/all и страницах категорий из меню уже содержат название и цену.
#
# Сознательно НЕ в SITE_HANDLERS/SUPPLEMENTAL_STORE_HANDLERS: те же реестры
# читает скрапер новых описаний (crawlers.py, main.py), а здесь элементы
# неполные — только url/title/price/oldPrice, без описаний и картинок.
#
# Семантика цены та же, что у _extract_nethouse_shop_details_price (hooks.py):
# есть скидка — price = цена со скидкой, oldPrice = исходная; иначе price =
# исходная. Карточку, в которой цену однозначно прочитать нельзя, пропускаем
# (не отдаём в результат): проверка цен тогда сходит на страницу товара обычным
# GET — это безопаснее, чем записать в БД неверное число.
#
# house-yarn.ru сюда не входит: цена в его карточках только в тексте названия
# ("... 650 руб"), блока .product-price нет.

import re
import time

import requests
from bs4 import BeautifulSoup

NETHOUSE_LISTING_DOMAINS = (
    'nastasiay.ru',
    'koledovaelena.ru',
    'viajeuvie.com',
    'nadin-shop.com',
    'elena-ianson.ru',
    'tatianaodintsova.com',
    'mary-knit.com',
    'crochet-together.com',
    'lily-knitting.com',
    'kolechkoknit.ru',
    'marini-sti.com',
)

LISTING_PAUSE_SECONDS = 0.5
MAX_CATEGORY_PAGES = 30


def _to_number(text):
    # "1 100 pуб." / "350 руб." -> 1100.0 / 350.0; копейки отбрасываются так же,
    # как в запасном пути детального парсера.
    digits = re.sub(r'[^\d]', '', text.split(',')[0])
    return float(digits) if digits else None


def _parse_card_price(card):
    # Возвращает (price, old_price) или None, если цену однозначно прочитать
    # нельзя (нет блока цены, "от ..." у вариантов, нет числа).
    block = card.select_one('div.product-price')
    if block is None:
        return None
    text = block.get_text(' ', strip=True)
    if re.search(r'(?i)\bот\b', text):
        return None
    old_el = block.select_one('.product-price-old')
    disc_el = block.select_one('.product-price-discount')
    if old_el is not None and disc_el is not None:
        origin, disc = _to_number(old_el.get_text()), _to_number(disc_el.get_text())
        if origin is None or disc is None:
            return None
        if 0 < disc < origin:
            return disc, origin
        return origin, None
    if re.search(r'(?i)бесплатн', text):
        return 0.0, None
    single = block.select_one('.product-price-min') or block
    value = _to_number(single.get_text())
    if value is None:
        return None
    return value, None


def _parse_listing_page(html):
    soup = BeautifulSoup(html, 'html.parser')
    items = {}
    for card in soup.select('a.product[href]'):
        parsed = _parse_card_price(card)
        if parsed is None:
            continue
        name_el = card.select_one('.product-name')
        items[card['href'].strip()] = {
            'url': card['href'].strip(),
            'title': name_el.get_text(strip=True) if name_el else None,
            'price': parsed[0],
            'oldPrice': parsed[1],
        }
    category_urls = [a['href'].strip() for a in soup.select('nav.shop-menu a[href]')]
    return items, category_urls


def scrape_nethouse_price_listing(domain, headers):
    base = f'https://{domain}'
    items = {}
    visited = set()
    queue = [f'{base}/shop', f'{base}/shop/all']

    while queue and len(visited) < MAX_CATEGORY_PAGES:
        page_url = queue.pop(0).rstrip('/')
        if page_url in visited:
            continue
        visited.add(page_url)
        try:
            resp = requests.get(page_url, headers=headers, timeout=15)
        except requests.exceptions.RequestException:
            if len(visited) == 1:
                # Недоступна главная страница каталога — дальше идти нет смысла,
                # пусть вызывающий увидит это как ошибку хендлера.
                raise
            continue
        finally:
            time.sleep(LISTING_PAUSE_SECONDS)
        # /shop/all есть не у всех магазинов (404) — это не ошибка.
        if resp.status_code >= 400:
            if len(visited) == 1:
                raise ValueError(f'HTTP {resp.status_code} на {page_url}')
            continue
        page_items, category_urls = _parse_listing_page(resp.text)
        items.update(page_items)
        for href in category_urls:
            full = href if href.startswith('http') else f'{base}{href}'
            if full.startswith(f'{base}/shop/') and full.rstrip('/') not in visited:
                queue.append(full)

    return list(items.values())
