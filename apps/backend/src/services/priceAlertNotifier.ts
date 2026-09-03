/**
 * Уведомление в бот о снижении цены описания, на которое подписан
 * пользователь (implementation_plan.md — «Подписка на цены»).
 *
 * Тот же паттерн, что subscriptionNotifier.ts: отправка через
 * telegram-gateway `/send-message` (а не напрямую в api.telegram.org —
 * ETIMEDOUT на проде), функция никогда не бросает — упавшая доставка не
 * должна ронять весь прогон джоба на остальных подписчиках. Возвращает
 * факт доставки.
 *
 * parse_mode НЕ используется: текст содержит произвольное название
 * описания, любой `_`/`*` в нём сломал бы Markdown-разбор. У `/send-message`
 * его и нет.
 */

async function sendViaGateway(telegramId: bigint, text: string): Promise<boolean> {
  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const apiKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  if (!baseUrl || !apiKey) {
    console.log(`[PriceAlert] Gateway not configured — message for ${telegramId}:\n${text}`);
    return false;
  }

  try {
    const response = await fetch(`${baseUrl}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Key": apiKey,
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ chatId: telegramId.toString(), text }),
    });

    if (!response.ok) {
      console.error(`[PriceAlert] Gateway API error: ${response.status} ${response.statusText}`);
      console.error("[PriceAlert] Details:", await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[PriceAlert] Network error sending message to Gateway:", err);
    return false;
  }
}

// Целые рубли без ".0" — цена приходит числом из changes[].
function formatPrice(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

/**
 * @param oldPrice предыдущая фактическая цена (changes[].oldPrice)
 * @param newPrice новая фактическая цена (changes[].newPrice)
 */
export async function sendPriceDropAlert(
  telegramId: bigint,
  patternTitle: string,
  oldPrice: number,
  newPrice: number,
  patternId: string,
): Promise<boolean> {
  const text =
    `💸 Цена снизилась!\n\n` +
    `«${patternTitle}»\n` +
    `Была: ${formatPrice(oldPrice)} ₽ → Стала: ${formatPrice(newPrice)} ₽\n\n` +
    `https://rapport.su/pattern/${patternId}`;
  return sendViaGateway(telegramId, text);
}
