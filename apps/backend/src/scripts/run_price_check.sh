#!/usr/bin/env bash
# Обёртка для check_price_updates.py — устанавливается пользователем в
# cron на проде, дважды в сутки (сам скрипт cron не трогает и не
# устанавливает).
#
# Делает то, что не может/не должно быть в самом Python-скрипте:
#   - подтягивает DATABASE_URL/BOT_TOKEN/TELEGRAM_GATEWAY_BASE_URL из .env
#     бэкенда (`set -a; source ../../.env; set +a`) — cron даёт голое
#     окружение, .env не подхватывается сам собой. BOT_TOKEN — тот же
#     существующий бот, что уже использует chatController.ts/
#     whitelistController.ts, не отдельный токен под этот джоб.
#     TELEGRAM_GATEWAY_BASE_URL обязателен на проде — прямые запросы к
#     api.telegram.org с этого сервера ненадёжны (см.
#     services/loginCodeSender.ts: "to avoid ETIMEDOUT issues on the
#     production server"); при отсутствии — fallback на прямой адрес
#     (локальная разработка);
#   - flock, чтобы предыдущий прогон, если он почему-то не уложился в
#     положенное окно, не запустился поверх следующего;
#   - отдельное уведомление в Telegram, если прогон пропущен из-за занятого
#     лока — иначе это выглядело бы как тихий "успех" (exit 0), хотя на
#     самом деле ничего не проверилось;
#   - отдельное уведомление в Telegram, если сам Python-скрипт упал целиком
#     (ненулевой exit code) — ошибки/эскалации внутри check_price_updates.py
#     не отправятся, если он не дошёл до конца, поэтому "джоб упал" живёт
#     здесь, а не там.
#
# Получатель — конкретный человек (ADMIN_TELEGRAM_ID ниже), не все ADMIN.
# Чистый прогон без ошибок в Telegram не шлётся вообще — результат уходит
# в PriceCheckRun, читает админка (вкладка "Справочник").
#
# Рекомендуемый cron (устанавливается вручную, не этим файлом):
#   0 3,15 * * * /var/www/rapport/apps/backend/src/scripts/run_price_check.sh >> /var/log/rapport/price_check.log 2>&1
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../.env"
LOCK_FILE="/tmp/price_check.lock"
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
  notify "Price check: предыдущий прогон ещё не завершился, этот прогон пропущен."
  exit 0
fi

cd "$SCRIPT_DIR"
set +e
python3 check_price_updates.py "$@"
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  notify "Price check: джоб упал целиком (exit code ${RC}), см. лог на проде (/var/log/rapport/price_check.log)."
fi

exit "$RC"
