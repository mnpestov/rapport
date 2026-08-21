#!/usr/bin/env bash
# Обёртка для reconcilePayments.ts — устанавливается пользователем в cron
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
#   */15 * * * * /var/www/rapport/apps/backend/src/scripts/run_payment_reconcile.sh >> /var/log/rapport/payment_reconcile.log 2>&1
#
# Каждые 15 минут: прогон дёргает Robokassa только по платежам старше
# получаса, поэтому обычно проверять нечего и запрос вообще не уходит.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../.."
ENV_FILE="$BACKEND_DIR/.env"

# cron запускает джоб с почти пустым окружением: PATH сводится к /usr/bin:/bin,
# HOME может отсутствовать. Проверено на проде — `npx tsx` в таких условиях
# падает с "sh: 1: tsx: not found" (npx не добирается до локального пакета
# без нормального окружения npm). Поэтому вызываем бинарь tsx из
# node_modules напрямую, а PATH задаём явно: сам tsx — sh-скрипт, которому
# нужен node из /usr/bin. Соседний run_price_check.sh с этим не сталкивался,
# т.к. запускает системный python3.
export PATH="/usr/bin:/bin:$PATH"
TSX_BIN="$BACKEND_DIR/node_modules/.bin/tsx"
LOCK_FILE="/tmp/payment_reconcile.lock"
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
  notify "Payment reconcile: предыдущий прогон ещё не завершился, этот прогон пропущен."
  exit 0
fi

if [ ! -x "$TSX_BIN" ]; then
  notify "Payment reconcile: не найден $TSX_BIN — похоже, не установлены зависимости бэкенда. Джоб не запущен."
  exit 1
fi

cd "$BACKEND_DIR"
set +e
"$TSX_BIN" src/scripts/reconcilePayments.ts "$@"
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  notify "Payment reconcile: джоб упал целиком (exit code ${RC}), см. лог на проде (/var/log/rapport/payment_reconcile.log)."
fi

exit "$RC"
