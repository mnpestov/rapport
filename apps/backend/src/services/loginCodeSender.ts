/**
 * Delivery channel for one-time web/admin login codes.
 *
 * Currently a STUB: it only logs the code. Swap the body of sendLoginCode
 * for a real Telegram Bot API call when the bot is wired up — the call sites
 * (webAuthController) do not need to change.
 *
 * Future real implementation (sketch):
 *
 *   const token = process.env.BOT_TOKEN;
 *   await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify({
 *       chat_id: telegramId.toString(),
 *       text: `Ваш код для входа: ${code}`,
 *     }),
 *   });
 */
export async function sendLoginCode(
  telegramId: bigint,
  code: string
): Promise<void> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("[LoginCode] Failed to send code: BOT_TOKEN is not configured.");
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        chat_id: telegramId.toString(),
        text: `Ваш одноразовый код для входа в Rapport Admin:\n\n**${code}**\n\nКод действителен 5 минут. Никому не сообщайте этот код!`,
        parse_mode: "Markdown"
      }),
    });

    if (!response.ok) {
      console.error(`[LoginCode] Telegram API error: ${response.status} ${response.statusText}`);
      const data = await response.text();
      console.error("[LoginCode] Details:", data);
    }
  } catch (err) {
    console.error("[LoginCode] Network error sending code to Telegram:", err);
  }
}
