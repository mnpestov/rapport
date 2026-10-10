# Маршрутизация запросов к Nethouse-сайтам через SOCKS-прокси (казахстанский
# сервер с тг-gateway): хостинг Nethouse (158.255.0.117) режет прод-IP, а с
# казахстанского и с домашнего IP те же сайты открываются.
#
# Включается ТОЛЬКО переменной окружения NETHOUSE_PROXY, например
# "socks5h://127.0.0.1:1080" (socks5h — DNS резолвится на стороне прокси). Без
# неё модуль ничего не делает, поведение скриптов прежнее.
#
# Подключается один раз на уровне пакета (author_sync_lib/__init__.py) и
# патчит requests.Session.request — через него идут все requests.get/post в
# скраппере и в проверке цен, поэтому ни один вызов в коде менять не нужно.
# Через прокси идут только запросы к хостам из NETHOUSE_PROXY_HOSTS либо тем,
# что резолвятся в NETHOUSE_PROXY_IPS (по умолчанию 158.255.0.117 — так
# подхватываются и будущие авторы на Nethouse). Всё остальное — напрямую.

import os
import socket
from urllib.parse import urlparse

import requests

PROXY_URL = os.environ.get('NETHOUSE_PROXY', '').strip()

# Известные Nethouse-домены — запасной признак на случай, если DNS не ответил.
NETHOUSE_PROXY_HOSTS = {
    'nastasiay.ru', 'koledovaelena.ru', 'viajeuvie.com', 'nadin-shop.com',
    'elena-ianson.ru', 'tatianaodintsova.com', 'mary-knit.com',
    'crochet-together.com', 'lily-knitting.com', 'kolechkoknit.ru',
    'marini-sti.com', 'house-yarn.ru', 'knitskate.com',
}
NETHOUSE_PROXY_IPS = {
    ip.strip() for ip in os.environ.get('NETHOUSE_PROXY_IPS', '158.255.0.117').split(',') if ip.strip()
}

_host_decision = {}


def _should_proxy(host):
    if host in _host_decision:
        return _host_decision[host]
    decision = host in NETHOUSE_PROXY_HOSTS or host.removeprefix('www.') in NETHOUSE_PROXY_HOSTS
    if not decision:
        try:
            decision = socket.gethostbyname(host) in NETHOUSE_PROXY_IPS
        except OSError:
            decision = False
    _host_decision[host] = decision
    return decision


def _enable():
    try:
        import socks  # noqa: F401  (PySocks — нужен requests для socks-прокси)
    except ImportError:
        print('[proxy] NETHOUSE_PROXY задан, но PySocks не установлен — прокси отключён, запросы идут напрямую')
        return

    original_request = requests.Session.request

    def request(self, method, url, **kwargs):
        if not kwargs.get('proxies'):
            host = (urlparse(url).hostname or '').lower()
            if host and _should_proxy(host):
                kwargs['proxies'] = {'http': PROXY_URL, 'https': PROXY_URL}
        return original_request(self, method, url, **kwargs)

    requests.Session.request = request
    print(f'[proxy] запросы к Nethouse-сайтам идут через {PROXY_URL}')


if PROXY_URL:
    _enable()
