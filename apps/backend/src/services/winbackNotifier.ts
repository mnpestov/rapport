/**
 * Мягкий чекин платным подписчикам, переставшим заходить (winback, план в
 * чате — сентябрь 2026). Через тот же telegram-gateway, что и
 * authorNotifier.ts, generic-прокси `/bot:token/sendMessage` — нужны
 * inline-кнопки (`reply_markup`), а custom `/send-message`
 * (subscriptionNotifier.ts) их не поддерживает.
 *
 * Нажатия кнопок обрабатывает support-bot (единственный бот с вебхуком на
 * callback_query) — см. apps/support-bot/src/bot/handlers/winback.ts.
 */

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

async function sendMessage(
  telegramId: bigint,
  text: string,
  replyMarkup: { inline_keyboard: InlineKeyboardButton[][] }
): Promise<boolean> {
  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const botToken = process.env.BOT_TOKEN;

  if (!baseUrl || !botToken) {
    console.log(`[WinbackNotifier] Gateway not configured — message for ${telegramId}:\n${text}`);
    return false;
  }

  try {
    const response = await fetch(`${baseUrl}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        chat_id: telegramId.toString(),
        text,
        reply_markup: replyMarkup,
      }),
    });

    if (!response.ok) {
      console.error(`[WinbackNotifier] Gateway API error: ${response.status} ${response.statusText}`);
      console.error("[WinbackNotifier] Details:", await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[WinbackNotifier] Network error sending message to Gateway:", err);
    return false;
  }
}

// callback_data держим короткими и с общим префиксом "winback:" — support-bot
// маршрутизирует по нему в один хендлер вместо четырёх отдельных.
const KEYBOARD: { inline_keyboard: InlineKeyboardButton[][] } = {
  inline_keyboard: [
    [{ text: "Не нашла нужное описание", callback_data: "winback:didnt_find" }],
    [{ text: "Сложно пользоваться приложением", callback_data: "winback:hard_to_use" }],
    [{ text: "Всё хорошо, скоро вернусь", callback_data: "winback:all_good" }],
    [{ text: "Не спрашивать больше", callback_data: "winback:opt_out" }],
  ],
};

export async function sendWinbackCheckin(telegramId: bigint): Promise<boolean> {
  const text =
    "Давно вас не было видно в Раппорте 🧶\n\n" +
    "Что-то не так, или просто закрутились в делах?";
  return sendMessage(telegramId, text, KEYBOARD);
}
