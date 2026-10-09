#!/usr/bin/env bash
# Локальный запуск проверки цен для Nethouse-авторов (--nethouse) с Mac, с
# записью в прод-БД через SSH-туннель. Нужен, пока прод-IP заблокирован
# хостингом Nethouse (158.255.0.117) — с домашнего IP их сайты открываются.
#
# Что делает:
#   - поднимает SSH-туннель к проду: Postgres (127.0.0.1:5432 -> localhost:15432)
#     и бэкенд (127.0.0.1:3000 -> localhost:13000, через него уходят
#     уведомления подписчикам PRICE_ALERT о снижении цены);
#   - DATABASE_URL и BOT_API_KEY читает с прода прямо из .env в момент запуска
#     (ничего не хранится и не печатается локально);
#   - запускает check_price_updates.py --nethouse;
#   - закрывает туннель при любом исходе (trap).
#
# Telegram-алерты об ошибках локально НЕ отправляются (BOT_TOKEN не
# задаётся) — итог смотреть в консоли и в админке («Справочник»), прогон
# пишется в PriceCheckRun. Снапшоты, state и отчёты ложатся в эту же папку
# локально (в .gitignore); счётчики хронических ошибок локальные.
#
# Использование:  ./run_price_check_local.sh
set -euo pipefail

SSH_TARGET="${PRICE_CHECK_SSH_TARGET:-app@5.129.246.160}"
PROD_ENV="/var/www/rapport/apps/backend/.env"
LOCAL_DB_PORT=15432
LOCAL_BACKEND_PORT=13000
SOCKET="$(mktemp -u /tmp/price_check_ssh.XXXXXX)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  ssh -S "$SOCKET" -O exit "$SSH_TARGET" >/dev/null 2>&1 || true
  rm -f "$SOCKET"
}
trap cleanup EXIT

# ExitOnForwardFailure: если локальный порт уже занят, туннель не поднимется
# молча, а упадёт — иначе скрипт мог бы подключиться к чужой БД на этом порту.
ssh -M -S "$SOCKET" -f -N \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "${LOCAL_DB_PORT}:127.0.0.1:5432" \
  -L "${LOCAL_BACKEND_PORT}:127.0.0.1:3000" \
  "$SSH_TARGET"

read_prod_var() {
  ssh -S "$SOCKET" "$SSH_TARGET" "grep -m1 '^$1=' '$PROD_ENV' | cut -d= -f2-" | tr -d '"'
}

PROD_DB_URL="$(read_prod_var DATABASE_URL)"
BOT_API_KEY="$(read_prod_var BOT_API_KEY)"
if [ -z "$PROD_DB_URL" ] || [ -z "$BOT_API_KEY" ]; then
  echo "Не удалось прочитать DATABASE_URL/BOT_API_KEY с прода" >&2
  exit 1
fi

# postgresql://user:pass@127.0.0.1:5432/db?schema=public -> тот же, но на
# локальный конец туннеля и без ?schema (psycopg2 его не понимает).
DATABASE_URL="$(echo "$PROD_DB_URL" | sed -E "s#@[^/]+/#@127.0.0.1:${LOCAL_DB_PORT}/#; s#\?.*\$##")"
export DATABASE_URL
export BOT_API_KEY
export BACKEND_URL="http://127.0.0.1:${LOCAL_BACKEND_PORT}"
unset BOT_TOKEN TELEGRAM_GATEWAY_BASE_URL

cd "$SCRIPT_DIR"
python3 check_price_updates.py --nethouse
