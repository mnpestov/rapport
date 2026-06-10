export async function checkTelegramSubscription(userId: number): Promise<boolean> {
  const botToken = process.env.BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  if (!botToken || !channelId) {
    console.error("[CheckSubscription] BOT_TOKEN or TELEGRAM_CHANNEL_ID is not configured. Falling back to true (fail-open).");
    return true; // Fail-open
  }

  // Remove < and > from botToken if they exist (sometimes users accidentally include them from instructions)
  const cleanBotToken = botToken.replace(/[<>]/g, "");

  const url = `https://api.telegram.org/bot${cleanBotToken}/getChatMember?chat_id=${channelId}&user_id=${userId}`;

  const safeUrl = `https://api.telegram.org/bot[HIDDEN_TOKEN]/getChatMember?chat_id=${channelId}&user_id=${userId}`;
  console.log(`\n--- [CheckSubscription DEBUG] ---`);
  console.log(`[CheckSubscription DEBUG] URL: ${safeUrl}`);

  let isSubscriber = true;
  try {
    const response = await fetch(url);
    console.log(`[CheckSubscription DEBUG] HTTP Status: ${response.status} ${response.statusText}`);
    const data = await response.json();
    console.log(`[CheckSubscription DEBUG] Response Body: ${JSON.stringify(data)}`);

    if (!response.ok) {
      // Handle explicitly negative responses (e.g., 400 User not found)
      if (response.status === 400) {
        console.warn(`[CheckSubscription] Telegram API returned 400 for user ${userId}: ${data.description}. Returning false.`);
        isSubscriber = false;
      } else {
        // For 5xx, timeouts, or other network-level API issues, we fail-open
        console.error(`[CheckSubscription] Telegram API error: HTTP ${response.status} - ${data.description}. Falling back to true (fail-open).`);
        isSubscriber = true;
      }
    } else if (!data.ok) {
      console.error(`[CheckSubscription] Telegram API returned ok=false: ${data.description}. Falling back to true (fail-open).`);
      isSubscriber = true; // Fail-open for unknown logical errors
    } else {
      const status = data.result?.status;

      // Subscribed statuses
      if (status === "creator" || status === "administrator" || status === "member") {
        isSubscriber = true;
      } else if (status === "left" || status === "kicked" || status === "restricted") {
        // Unsubscribed statuses
        console.log(`[CheckSubscription] User ${userId} has status '${status}'. Returning false.`);
        isSubscriber = false;
      } else {
        // Default to true for any other unhandled status to not block users by mistake
        console.warn(`[CheckSubscription] Unhandled status '${status}' for user ${userId}. Falling back to true (fail-open).`);
        isSubscriber = true;
      }
    }
  } catch (error) {
    console.error(`[CheckSubscription] Network error checking subscription for user ${userId}:`, error);
    isSubscriber = true; // Fail-open
  }

  console.log(`[CheckSubscription DEBUG] Calculated isSubscriber: ${isSubscriber}`);
  console.log(`--- [CheckSubscription DEBUG END] ---\n`);
  return isSubscriber;
}
