export async function checkTelegramSubscription(userId: number): Promise<boolean> {
  const gatewayUrl = process.env.TELEGRAM_GATEWAY_URL;
  const gatewayKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  if (!gatewayUrl || !gatewayKey) {
    console.error("[CheckSubscription] TELEGRAM_GATEWAY_URL or TELEGRAM_GATEWAY_API_KEY is not configured. Falling back to true (fail-open).");
    return true; // Fail-open
  }

  console.log(`\n--- [CheckSubscription DEBUG] ---`);
  console.log(`[CheckSubscription DEBUG] Gateway URL: ${gatewayUrl}`);

  let isSubscriber = true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gateway-Key": gatewayKey,
        },
        body: JSON.stringify({ userId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    console.log(`[CheckSubscription DEBUG] HTTP Status: ${response.status} ${response.statusText}`);
    
    const data = await response.json().catch(() => null);
    console.log(`[CheckSubscription DEBUG] Response Body: ${JSON.stringify(data)}`);

    if (!response.ok) {
      console.error(`[CheckSubscription] Gateway error: HTTP ${response.status}. Falling back to true (fail-open).`);
      isSubscriber = true;
    } else if (data && typeof data.isSubscriber === 'boolean') {
      isSubscriber = data.isSubscriber;
    } else {
      console.warn(`[CheckSubscription] Unexpected gateway response format. Falling back to true (fail-open).`);
      isSubscriber = true;
    }
  } catch (error) {
    console.error(`[CheckSubscription] Network error communicating with Gateway for user ${userId}:`, error);
    isSubscriber = true; // Fail-open
  }

  console.log(`[CheckSubscription DEBUG] Calculated isSubscriber: ${isSubscriber}`);
  console.log(`--- [CheckSubscription DEBUG END] ---\n`);
  return isSubscriber;
}
