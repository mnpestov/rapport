/**
 * Notification service for the author login/password + application flow
 * (implementation_plan.md §5). Uses the same external telegram-gateway as
 * loginCodeSender.ts, for the same reason: avoids ETIMEDOUT issues calling
 * the Telegram API directly from the production server.
 *
 * Goes through the gateway's generic `/bot:token/:method` proxy (a
 * pass-through to api.telegram.org/bot<token>/<method>) rather than its
 * custom `/send-message` endpoint — same pattern as
 * whitelistController.ts's notifyWhitelistUser. The custom endpoint only
 * forwards {chatId, text, parseMode} and drops everything else, so it
 * cannot carry an inline keyboard; the generic proxy passes the body
 * through untouched, so reply_markup (needed by sendNeedsInfo below) works.
 */

interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

async function sendMessage(
  telegramId: bigint,
  text: string,
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] }
): Promise<void> {
  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const botToken = process.env.BOT_TOKEN;

  if (!baseUrl || !botToken) {
    console.log(`[AuthorNotifier] Gateway not configured — message for ${telegramId}:\n${text}`);
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        chat_id: telegramId.toString(),
        text,
        parse_mode: "Markdown",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });

    if (!response.ok) {
      console.error(`[AuthorNotifier] Gateway API error: ${response.status} ${response.statusText}`);
      const data = await response.text();
      console.error("[AuthorNotifier] Details:", data);
    }
  } catch (err) {
    console.error("[AuthorNotifier] Network error sending message to Gateway:", err);
  }
}

export async function sendCredentials(telegramId: bigint, login: string, tempPassword: string): Promise<void> {
  await sendMessage(
    telegramId,
    `Ваша заявка на авторский кабинет одобрена! 🎉\n\n` +
      `Вход в панель: admin.rapport.su\n` +
      `Логин: \`${login}\`\n` +
      `Временный пароль: \`${tempPassword}\`\n\n` +
      `При первом входе потребуется сменить пароль.`
  );
}

export async function sendResendCredentials(telegramId: bigint, login: string, tempPassword: string): Promise<void> {
  await sendMessage(
    telegramId,
    `Для вашего аккаунта выпущен новый временный пароль.\n\n` +
      `Вход в панель: admin.rapport.su\n` +
      `Логин: \`${login}\`\n` +
      `Временный пароль: \`${tempPassword}\`\n\n` +
      `При входе потребуется сменить пароль.`
  );
}

export async function sendNeedsInfo(telegramId: bigint, comment: string): Promise<void> {
  await sendMessage(
    telegramId,
    `По вашей заявке на авторский кабинет требуется уточнение:\n\n${comment}\n\n` +
      `Нажмите «Ответить» ниже, чтобы дополнить заявку текстом или новыми ссылками — ` +
      `отвечать нужно в этой кнопке, а не отдельным сообщением в чат.`,
    {
      inline_keyboard: [
        [{ text: "Ответить", callback_data: "author_app:respond_start" }],
        [{ text: "Отмена", callback_data: "author_app:cancel" }],
      ],
    }
  );
}

export async function sendRejected(telegramId: bigint, comment?: string | null): Promise<void> {
  await sendMessage(
    telegramId,
    `Ваша заявка на авторский кабинет отклонена.${comment ? `\n\nПричина: ${comment}` : ""}`
  );
}

export async function sendForgotPassword(telegramId: bigint, code: string): Promise<void> {
  await sendMessage(
    telegramId,
    `Код для сброса пароля авторского кабинета:\n\n**${code}**\n\n` +
      `Код действителен 5 минут. Никому не сообщайте этот код!`
  );
}
