#!/usr/bin/env bash
# Обёртка для checkWinback.ts — устанавливается пользователем в cron на
# проде, раз в сутки (сам скрипт cron не трогает и не устанавливает).
# Построена по образцу run_subscription_check.sh — та же причина: cron
# даёт голое окружение, .env бэкенда сам собой не подхватывается, и tsx
# нужно вызывать напрямую из node_modules, а не через npx.
#
# Рекомендуемый cron (устанавливается вручную, не этим файлом):
#   0 11 * * * /var/www/rapport/apps/backend/src/scripts/run_winback_check.sh >> /var/log/rapport/winback_check.log 2>&1
#
# Время 11:00 выбрано в стороне от 3:00 (pg_dump), 3:00/15:00 (price
# check) и 4:30 (subscription check) — джоб тоже шлёт сообщения
# пользователям, дневное время разумнее ночного для этого типа сообщения.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../.."
ENV_FILE="$BACKEND_DIR/.env"

export PATH="/usr/bin:/bin:$PATH"
TSX_BIN="$BACKEND_DIR/node_modules/.bin/tsx"
LOCK_FILE="/tmp/winback_check.lock"
ADMIN_TELEGRAM_ID="505293788"  # @mnpestov — не секрет, публичный Telegram user id

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

notify() {
  local text="$1"
  if [ -n "${BOT_TOKEN:-}" ]; then
    local gateway_base="${TELEGRAM_GATEWAY_BASE_URL:-https://api.telegram.org}"
    curl -s -X POST "${gateway_base}/bot${BOT_TOKEN}/sendMessage" \
      -d "chat_id=${ADMIN_TELEGRAM_ID}" \
      -d "text=${text}" > /dev/null || echo "[wrapper] notify failed"
  else
    echo "[wrapper] BOT_TOKEN не задан, уведомление пропущено: $text"
  fi
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  notify "Winback check: предыдущий прогон ещё не завершился, этот прогон пропущен."
  exit 0
fi

if [ ! -x "$TSX_BIN" ]; then
  notify "Winback check: не найден $TSX_BIN — похоже, не установлены зависимости бэкенда. Джоб не запущен."
  exit 1
fi

cd "$BACKEND_DIR"
set +e
"$TSX_BIN" src/scripts/checkWinback.ts "$@"
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  notify "Winback check: джоб упал целиком (exit code ${RC}), см. лог на проде (/var/log/rapport/winback_check.log)."
fi

exit "$RC"
