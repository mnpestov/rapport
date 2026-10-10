#!/usr/bin/env bash
# Локальный запуск скраппера новинок (author_sync.py) для одного автора с
# Mac, с записью в прод-БД через SSH-туннель. Нужен для авторов на Nethouse
# (158.255.0.117), пока прод-IP заблокирован их хостингом: кнопка «Проверить
# новинки» в админке запускает тот же скрипт на проде, и он падает с
# ConnectTimeout. Аналог run_price_check_local.sh.
#
# Результат — как у кнопки в админке: AuthorSyncReport/AuthorSyncItem в
# очереди модерации (вкладка модерации), ничего не публикуется само.
# Скрапер ходит в сеть и пишет только в БД (плюс локальный sync_stats.md).
#
# Использование:  ./run_author_sync_local.sh <authorId>
#   authorId — id автора из админки (тот же, что уходит кнопке «Проверить новинки»).
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Использование: $0 <authorId>" >&2
  exit 1
fi
AUTHOR_ID="$1"

SSH_TARGET="${PRICE_CHECK_SSH_TARGET:-app@5.129.246.160}"
PROD_ENV="/var/www/rapport/apps/backend/.env"
LOCAL_DB_PORT=15432
SOCKET="$(mktemp -u /tmp/author_sync_ssh.XXXXXX)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  ssh -S "$SOCKET" -O exit "$SSH_TARGET" >/dev/null 2>&1 || true
  rm -f "$SOCKET"
}
trap cleanup EXIT

# ExitOnForwardFailure: занятый локальный порт не должен молча подключить
# скрипт к чужой БД.
ssh -M -S "$SOCKET" -f -N \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "${LOCAL_DB_PORT}:127.0.0.1:5432" \
  "$SSH_TARGET"

PROD_DB_URL="$(ssh -S "$SOCKET" "$SSH_TARGET" "grep -m1 '^DATABASE_URL=' '$PROD_ENV' | cut -d= -f2-" | tr -d '"')"
if [ -z "$PROD_DB_URL" ]; then
  echo "Не удалось прочитать DATABASE_URL с прода" >&2
  exit 1
fi

DATABASE_URL="$(echo "$PROD_DB_URL" | sed -E "s#@[^/]+/#@127.0.0.1:${LOCAL_DB_PORT}/#; s#\?.*\$##")"
export DATABASE_URL

cd "$SCRIPT_DIR"
python3 author_sync.py "$AUTHOR_ID"
