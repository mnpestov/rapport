/**
 * Delivery channel for one-time web/admin login codes.
 *
 * Uses the external telegram-gateway instead of direct Telegram API calls
 * to avoid ETIMEDOUT issues on the production server.
 */
export async function sendLoginCode(
  telegramId: bigint,
  code: string
): Promise<void> {
  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const apiKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  if (!baseUrl || !apiKey) {
    console.error("[LoginCode] Failed to send code: TELEGRAM_GATEWAY_BASE_URL or TELEGRAM_GATEWAY_API_KEY is not configured.");
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/send-message`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-Gateway-Key": apiKey
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        chatId: telegramId.toString(),
        text: `Ваш одноразовый код для входа в Rapport Admin:\n\n**${code}**\n\nКод действителен 5 минут. Никому не сообщайте этот код!`,
        parseMode: "Markdown"
      }),
    });

    if (!response.ok) {
      console.error(`[LoginCode] Gateway API error: ${response.status} ${response.statusText}`);
      const data = await response.text();
      console.error("[LoginCode] Details:", data);
    }
  } catch (err) {
    console.error("[LoginCode] Network error sending code to Gateway:", err);
  }
}
