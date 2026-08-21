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
const MUTE_WINDOW_MS = 15 * 60 * 1000;
const lastSentAt = new Map<string, number>();

export async function sendPaymentAlert(key: string, text: string): Promise<void> {
  const now = Date.now();
  const previous = lastSentAt.get(key);
  if (previous && now - previous < MUTE_WINDOW_MS) return;
  lastSentAt.set(key, now);

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
