/**
 * Сообщения в бот по жизненному циклу платной подписки — напоминание за
 * 3 дня и уведомление о самом отключении (PAYMENTS_ROBOKASSA_PLAN.md §6,
 * §7 шаг 7; решение по открытому вопросу §8.2 — шлём оба).
 *
 * Тот же паттерн, что loginCodeSender.ts / paymentReceiptSender.ts:
 * отправка через telegram-gateway, а не напрямую в api.telegram.org
 * (ETIMEDOUT на проде), и функция никогда не бросает — упавшая доставка
 * не должна ронять весь cron-прогон на остальных пользователях. Как и в
 * paymentReceiptSender, возвращаем факт доставки, а не void: cron
 * помечает `premiumReminderSentAt` только при реально ушедшем
 * напоминании, иначе пользователь молча остался бы без предупреждения.
 */

async function sendViaGateway(telegramId: bigint, text: string, logTag: string): Promise<boolean> {
  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const apiKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  if (!baseUrl || !apiKey) {
    console.log(`[${logTag}] Gateway not configured — message for ${telegramId}:\n${text}`);
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
      console.error(`[${logTag}] Gateway API error: ${response.status} ${response.statusText}`);
      console.error(`[${logTag}] Details:`, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[${logTag}] Network error sending message to Gateway:`, err);
    return false;
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/** За 3 дня до истечения — предупреждение, пока доступ ещё работает. */
export async function sendExpiryReminder(telegramId: bigint, premiumExpiresAt: Date): Promise<boolean> {
  const text =
    `Ваша Премиум-подписка заканчивается ${formatDate(premiumExpiresAt)}.\n\n` +
    `Чтобы расширенные функции продолжили работать, продлите её в приложении — ` +
    `оплаченные дни не сгорают, новый месяц добавится к текущему сроку.`;
  return sendViaGateway(telegramId, text, "SubscriptionReminder");
}

/** В момент фактического отключения — уже после снятия разрешений. */
export async function sendExpiredNotice(telegramId: bigint): Promise<boolean> {
  const text =
    `Ваша Премиум-подписка закончилась — расширенные функции отключены.\n\n` +
    `Каталог, поиск и Избранное остаются доступны как раньше. ` +
    `Возобновить расширенный доступ можно в любой момент в приложении.`;
  return sendViaGateway(telegramId, text, "SubscriptionExpired");
}
