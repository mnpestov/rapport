/**
 * Sends the "payment successful" receipt message to the user's Telegram
 * chat via telegram-gateway — same pattern as loginCodeSender.ts (gateway
 * instead of direct Telegram API calls, to avoid ETIMEDOUT on the prod
 * server). Never throws — a gateway hiccup must not fail the Result URL
 * response Robokassa is waiting on — but DOES report success/failure via
 * its return value (unlike loginCodeSender's fire-and-forget void), because
 * the caller marks Payment.receiptSentAt only on a genuine delivery, not
 * merely on "we tried".
 */
export async function sendPaymentReceipt(
  telegramId: bigint,
  amountRub: number,
  premiumExpiresAt: Date
): Promise<boolean> {
  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const apiKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  const expiresLabel = premiumExpiresAt.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const text =
    `Оплата на ${amountRub} ₽ прошла успешно ✅\n\n` +
    `Расширенный функционал Rapport активен до ${expiresLabel}.`;

  if (!baseUrl || !apiKey) {
    console.log(`[PaymentReceipt] Gateway not configured — receipt for ${telegramId}:\n${text}`);
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
      body: JSON.stringify({
        chatId: telegramId.toString(),
        text,
      }),
    });

    if (!response.ok) {
      console.error(`[PaymentReceipt] Gateway API error: ${response.status} ${response.statusText}`);
      const data = await response.text();
      console.error("[PaymentReceipt] Details:", data);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[PaymentReceipt] Network error sending receipt to Gateway:", err);
    return false;
  }
}
