import fs from "fs";
import path from "path";

/**
 * Уведомления админу о проблемах с платежами (PAYMENTS_ROBOKASSA_PLAN.md
 * §10.5). До этого все такие случаи писались только в console.error — то
 * есть о них не узнавал никто. При этом "неверная подпись на Result URL"
 * буквально означает "нам платят, а мы не засчитываем": ровно это
 * происходило, когда разъехались пароли, и заметили только потому, что в
 * тот момент тестировали вручную.
 *
 * Отправка через telegram-gateway, как loginCodeSender/paymentReceiptSender.
 * Никогда не бросает: алерт не должен ронять обработчик, ради которого его
 * вызвали, — иначе поломка мониторинга превращается в поломку оплаты.
 */

// @mnpestov — не секрет, публичный Telegram user id. Тот же получатель, что
// у run_price_check.sh; отдельного канала под алерты пока не заводим.
const ADMIN_TELEGRAM_ID = "505293788";

// Одинаковые алерты подряд гасятся: Robokassa повторяет Result URL, и при
// systemic-поломке (разъехались пароли) прилетело бы по сообщению на
// каждую попытку каждого пользователя.
//
// Состояние живёт в файле, а не в Map в памяти процесса — see
// reconcilePayments.ts: run_payment_reconcile.sh запускает его из cron
// КАЖДЫЕ 15 минут отдельным процессом (`tsx script.ts`), и in-memory Map
// умирала вместе с процессом на каждом прогоне — окно молчания фактически
// никогда не срабатывало между вызовами из cron, только внутри одного
// прогона. Итог live-инцидента: алерт "no-successful-payments" слался
// каждые 15 минут часами подряд, хотя MUTE_WINDOW_MS = 15 минут — окно
// технически "работало", просто не переживало рестарт процесса. Файл
// переживает; вызывающая сторона (webhook в rapport-api, живущий часами) от
// этого не страдает — просто читает/пишет тот же файл вместо Map.
const MUTE_WINDOW_MS = 15 * 60 * 1000;
const STATE_PATH = path.join(__dirname, "../scripts/payment_alert_state.json");

function loadState(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    // Файла нет (первый запуск) или он битый — начинаем с чистого листа.
    // Худший случай — один лишний алерт, не пропущенный критичный.
    return {};
  }
}

function saveState(state: Record<string, number>): void {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch (err) {
    // Не смогли сохранить — окно молчания в следующий раз не сработает,
    // но сама отправка (ради которой всё это) уже прошла успешно. Не
    // бросаем: см. докстринг модуля.
    console.error("[PaymentAlert] Failed to persist mute state:", err);
  }
}

export async function sendPaymentAlert(key: string, text: string): Promise<void> {
  const now = Date.now();
  const state = loadState();
  const previous = state[key];
  if (previous && now - previous < MUTE_WINDOW_MS) return;
  state[key] = now;
  saveState(state);

  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const apiKey = process.env.TELEGRAM_GATEWAY_API_KEY;
  if (!baseUrl || !apiKey) {
    console.log(`[PaymentAlert] Gateway not configured — alert "${key}":\n${text}`);
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gateway-Key": apiKey },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ chatId: ADMIN_TELEGRAM_ID, text: `⚠️ Оплата Rapport\n\n${text}` }),
    });
    if (!response.ok) {
      console.error(`[PaymentAlert] Gateway API error: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.error("[PaymentAlert] Network error sending alert:", err);
  }
}
