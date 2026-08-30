/**
 * Notification service for the author login/password + application flow
 * (implementation_plan.md §5). Uses the same external telegram-gateway as
 * loginCodeSender.ts, for the same reason: avoids ETIMEDOUT issues calling
 * the Telegram API directly from the production server.
 */

async function sendMessage(telegramId: bigint, text: string): Promise<void> {
  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const apiKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  if (!baseUrl || !apiKey) {
    console.log(`[AuthorNotifier] Gateway not configured — message for ${telegramId}:\n${text}`);
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Key": apiKey,
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        chatId: telegramId.toString(),
        text,
        parseMode: "Markdown",
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
      `Подайте заявку повторно, когда будете готовы.`
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
