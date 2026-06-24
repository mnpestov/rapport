export async function checkTelegramSubscription(userId: number): Promise<boolean> {
  const gatewayUrl = process.env.TELEGRAM_GATEWAY_URL;
  const gatewayKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  if (!gatewayUrl || !gatewayKey) {
    console.error("[CheckSubscription] TELEGRAM_GATEWAY_URL or TELEGRAM_GATEWAY_API_KEY is not configured. Falling back to true (fail-open).");
    return true; // Fail-open
  }



  let isSubscriber = true;
  let gatewayResponse: unknown = null;
  let statusCode: number | string | null = null;
  let errorName: string | null = null;
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

    const data = await response.json().catch(() => null);
    gatewayResponse = data;
    statusCode = response.status;

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
    errorName = error instanceof Error ? error.name : String(error);
    statusCode = error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
    isSubscriber = true; // Fail-open
  }

  const debugParts = [
    `[SUBSCRIPTION_DEBUG] userId=${userId}`,
    `status=${statusCode ?? 'NONE'}`,
    `gatewayResponse=${JSON.stringify(gatewayResponse)}`,
    `finalResult=${isSubscriber}`,
  ];
  if (errorName) debugParts.push(`error=${errorName}`);
  console.log(debugParts.join(' '));

  return isSubscriber;
}
