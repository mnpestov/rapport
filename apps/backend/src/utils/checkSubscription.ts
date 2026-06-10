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

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      // Handle explicitly negative responses (e.g., 400 User not found)
      if (response.status === 400) {
        console.warn(`[CheckSubscription] Telegram API returned 400 for user ${userId}: ${data.description}. Returning false.`);
        return false;
      }
      
      // For 5xx, timeouts, or other network-level API issues, we fail-open
      console.error(`[CheckSubscription] Telegram API error: HTTP ${response.status} - ${data.description}. Falling back to true (fail-open).`);
      return true;
    }

    if (!data.ok) {
      console.error(`[CheckSubscription] Telegram API returned ok=false: ${data.description}. Falling back to true (fail-open).`);
      return true; // Fail-open for unknown logical errors
    }

    const status = data.result?.status;

    // Subscribed statuses
    if (status === "creator" || status === "administrator" || status === "member") {
      return true;
    }

    // Unsubscribed statuses
    if (status === "left" || status === "kicked" || status === "restricted") {
      console.log(`[CheckSubscription] User ${userId} has status '${status}'. Returning false.`);
      return false;
    }

    // Default to true for any other unhandled status to not block users by mistake
    console.warn(`[CheckSubscription] Unhandled status '${status}' for user ${userId}. Falling back to true (fail-open).`);
    return true;
    
  } catch (error) {
    console.error(`[CheckSubscription] Network error checking subscription for user ${userId}:`, error);
    return true; // Fail-open
  }
}
