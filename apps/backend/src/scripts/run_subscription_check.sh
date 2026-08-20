#!/usr/bin/env bash
# Обёртка для checkSubscriptions.ts — устанавливается пользователем в cron
# на проде, раз в сутки (сам скрипт cron не трогает и не устанавливает).
# Построена по образцу соседнего run_price_check.sh — те же причины:
#
#   - подтягивает DATABASE_URL/BOT_TOKEN/TELEGRAM_GATEWAY_* из .env
#     бэкенда: cron даёт голое окружение, .env сам собой не подхватывается
#     (в отличие от pm2, который стартует процесс из каталога бэкенда);
#   - flock — чтобы прогон не наложился на предыдущий, если тот почему-то
#     затянулся;
#   - уведомление админу, если прогон пропущен из-за занятого лока или
#     если сам скрипт упал целиком — иначе оба случая выглядели бы как
#     тихий успех, хотя подписки в этот день не проверились.
#
# Рекомендуемый cron (устанавливается вручную, не этим файлом):
#   30 4 * * * /var/www/rapport/apps/backend/src/scripts/run_subscription_check.sh >> /var/log/rapport/subscription_check.log 2>&1
#
# Время 4:30 выбрано, чтобы не пересекаться с уже занятыми 3:00 (pg_dump)
# и 3:00/15:00 (price check) — джоб шлёт сообщения пользователям, и
# конкурировать с бэкапом за диск ему незачем.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../.."
ENV_FILE="$BACKEND_DIR/.env"
LOCK_FILE="/tmp/subscription_check.lock"
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
  notify "Subscription check: предыдущий прогон ещё не завершился, этот прогон пропущен."
  exit 0
fi

cd "$BACKEND_DIR"
set +e
npx tsx src/scripts/checkSubscriptions.ts "$@"
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  notify "Subscription check: джоб упал целиком (exit code ${RC}), см. лог на проде (/var/log/rapport/subscription_check.log)."
fi

exit "$RC"
