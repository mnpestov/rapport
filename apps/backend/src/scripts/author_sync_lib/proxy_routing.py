# Защита Nethouse-сайтов от перегрузки и маршрутизация запросов к ним через
# SOCKS-прокси. Хостинг Nethouse (158.255.0.117) 7-8 октября 2026 начал резать
# прод-IP; с казахстанского (тг-gateway) и домашнего IP те же сайты открываются.
#
# Подключается один раз на уровне пакета (author_sync_lib/__init__.py) и
# патчит requests.Session.request — через него идут все requests.get/post в
# скраппере и в проверке цен, поэтому ни один вызов в коде менять не нужно.
# Всё ниже касается ТОЛЬКО Nethouse-хостов (NETHOUSE_PROXY_HOSTS либо
# резолвящихся в NETHOUSE_PROXY_IPS, по умолчанию 158.255.0.117 — так
# подхватываются и будущие авторы на Nethouse). Остальные запросы идут как раньше.
#
# Три независимых механизма:
#
#   1. Прокси. Включается переменной NETHOUSE_PROXY, например
#      "socks5h://127.0.0.1:1080" (socks5h — DNS резолвится на стороне
#      прокси). Без неё запросы идут напрямую. Если задан, а PySocks не
#      установлен — предупреждение и прямые запросы, а не падение.
#
#   2. Пауза между запросами к одному хосту: не чаще чем раз в
#      NETHOUSE_MIN_INTERVAL_SECONDS (по умолчанию 1.0). У скраппера новинок
#      своих пауз нет — до этого он слал до 15 страниц обхода подряд.
#
#   3. Предохранитель на хост. NETHOUSE_BREAKER_THRESHOLD (по умолчанию 3)
#      ошибок подряд (ошибка подключения/таймаут либо HTTP 403/429) —
#      дальнейшие запросы к этому хосту сразу падают с HostCircuitOpen, без
#      обращения к сети, на NETHOUSE_BREAKER_COOLDOWN_SECONDS (по умолчанию
#      3600 с — практически до конца прогона; каждый запуск скрипта — новый
#      процесс, состояние не переживает его). Любой успешный ответ сбрасывает
#      счётчик. По истечении паузы пропускается один пробный запрос. Нужен,
#      чтобы при блокировке мы не продолжали слать сотни запросов в сайт,
#      который уже не отвечает. HostCircuitOpen — подкласс ConnectionError,
#      поэтому проверка цен показывает его как «ссылка недоступна» (тип ошибки
#      виден в тексте), а скраппер — как обычную ошибку подключения.

import os
import socket
import time
from urllib.parse import urlparse

import requests

PROXY_URL = os.environ.get('NETHOUSE_PROXY', '').strip()


def _env_number(name, default, cast):
    try:
        return cast(os.environ.get(name, default))
    except (TypeError, ValueError):
        return cast(default)


MIN_INTERVAL_SECONDS = _env_number('NETHOUSE_MIN_INTERVAL_SECONDS', 1.0, float)
BREAKER_THRESHOLD = _env_number('NETHOUSE_BREAKER_THRESHOLD', 3, int)
BREAKER_COOLDOWN_SECONDS = _env_number('NETHOUSE_BREAKER_COOLDOWN_SECONDS', 3600, float)

# Статусы, которые считаются признаком блокировки/ограничения со стороны сайта.
# 404 и прочие ошибки страницы сюда не входят — это проблема конкретной ссылки.
BLOCK_STATUS_CODES = (403, 429)

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


class HostCircuitOpen(requests.exceptions.ConnectionError):
    pass


_host_decision = {}
_last_request_at = {}
_consecutive_failures = {}
_open_until = {}


def _is_nethouse_host(host):
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


def _check_breaker(host):
    until = _open_until.get(host)
    if until is None:
        return
    if time.monotonic() < until:
        raise HostCircuitOpen(f'предохранитель: запросы к {host} приостановлены после {BREAKER_THRESHOLD} ошибок подряд')
    # Пауза истекла — пропускаем один пробный запрос. Если он тоже окажется
    # неудачным, счётчик (не сброшенный) сразу снова откроет предохранитель.
    del _open_until[host]


def _throttle(host):
    last = _last_request_at.get(host)
    if last is not None:
        wait = MIN_INTERVAL_SECONDS - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
    _last_request_at[host] = time.monotonic()


def _record_failure(host):
    count = _consecutive_failures.get(host, 0) + 1
    _consecutive_failures[host] = count
    if count >= BREAKER_THRESHOLD and host not in _open_until:
        _open_until[host] = time.monotonic() + BREAKER_COOLDOWN_SECONDS
        print(f'[nethouse] {host}: {count} ошибок подряд, запросы к хосту приостановлены')


def _record_success(host):
    _consecutive_failures.pop(host, None)


def _proxy_available():
    if not PROXY_URL:
        return False
    try:
        import socks  # noqa: F401  (PySocks — нужен requests для socks-прокси)
    except ImportError:
        print('[proxy] NETHOUSE_PROXY задан, но PySocks не установлен — прокси отключён, запросы идут напрямую')
        return False
    print(f'[proxy] запросы к Nethouse-сайтам идут через {PROXY_URL}')
    return True


def _install():
    use_proxy = _proxy_available()
    original_request = requests.Session.request

    def request(self, method, url, **kwargs):
        host = (urlparse(url).hostname or '').lower()
        if not host or not _is_nethouse_host(host):
            return original_request(self, method, url, **kwargs)

        _check_breaker(host)
        _throttle(host)
        if use_proxy and not kwargs.get('proxies'):
            kwargs['proxies'] = {'http': PROXY_URL, 'https': PROXY_URL}
        try:
            resp = original_request(self, method, url, **kwargs)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            _record_failure(host)
            raise
        if resp.status_code in BLOCK_STATUS_CODES:
            _record_failure(host)
        else:
            _record_success(host)
        return resp

    requests.Session.request = request


_install()
