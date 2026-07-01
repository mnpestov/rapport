export interface SubscriptionCheckResult {
  isSubscriber: boolean;
  gatewayStatusCode: number | string | null;
  gatewayResponse: unknown;
  errorName: string | null;
  gatewayDurationMs: number | null;
  isParticipantIdInvalid: boolean;
}

async function _fetchSubscriptionResult(userId: number, requestId?: string): Promise<SubscriptionCheckResult> {
  const gatewayUrl = process.env.TELEGRAM_GATEWAY_URL;
  const gatewayKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  if (!gatewayUrl || !gatewayKey) {
    console.error("[CheckSubscription] TELEGRAM_GATEWAY_URL or TELEGRAM_GATEWAY_API_KEY is not configured. Falling back to true (fail-open).");
    return { isSubscriber: true, gatewayStatusCode: null, gatewayResponse: null, errorName: null, gatewayDurationMs: null, isParticipantIdInvalid: false };
  }

  let isSubscriber = true;
  let gatewayResponse: unknown = null;
  let statusCode: number | string | null = null;
  let errorName: string | null = null;
  let isParticipantIdInvalid = false;
  const gatewayStart = Date.now();
  let gatewayDurationMs: number | null = null;

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
          ...(requestId ? { "X-Request-Id": requestId } : {}),
        },
        body: JSON.stringify({ userId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const data = await response.json().catch(() => null);
    gatewayDurationMs = Date.now() - gatewayStart;
    gatewayResponse = data;
    statusCode = response.status;

    if (!response.ok) {
      console.error(`[CheckSubscription] Gateway error: HTTP ${response.status}. Falling back to true (fail-open).`);
      isSubscriber = true;
    } else if (data && typeof data.isSubscriber === 'boolean') {
      isSubscriber = data.isSubscriber;
      if (!isSubscriber && data.telegramOk === false && data.telegramResponse?.description === 'Bad Request: PARTICIPANT_ID_INVALID') {
        isParticipantIdInvalid = true;
      }
    } else {
      console.warn(`[CheckSubscription] Unexpected gateway response format. Falling back to true (fail-open).`);
      isSubscriber = true;
    }
  } catch (error) {
    gatewayDurationMs = Date.now() - gatewayStart;
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
    `durationMs=${gatewayDurationMs}`,
  ];
  if (errorName) debugParts.push(`error=${errorName}`);
  console.log(debugParts.join(' '));

  return { isSubscriber, gatewayStatusCode: statusCode, gatewayResponse, errorName, gatewayDurationMs, isParticipantIdInvalid };
}

// Retry once on a clean false — Telegram getChatMember can return stale data on first call.
async function _fetchWithRetry(userId: number, requestId?: string): Promise<SubscriptionCheckResult> {
  const result = await _fetchSubscriptionResult(userId, requestId);

  if (!result.isSubscriber && result.errorName === null && result.gatewayStatusCode === 200 && !result.isParticipantIdInvalid) {
    console.log(`[CheckSubscription] isSubscriber=false for userId=${userId}, retrying after 600ms`);
    await new Promise<void>(resolve => setTimeout(resolve, 600));
    const retry = await _fetchSubscriptionResult(userId, requestId);
    console.log(`[CheckSubscription] Retry result for userId=${userId}: isSubscriber=${retry.isSubscriber}`);
    return retry;
  }

  return result;
}

export async function checkTelegramSubscription(userId: number, requestId?: string): Promise<boolean> {
  const result = await _fetchWithRetry(userId, requestId);
  return result.isSubscriber;
}

export async function checkTelegramSubscriptionDetailed(userId: number, requestId?: string): Promise<SubscriptionCheckResult> {
  return _fetchWithRetry(userId, requestId);
}

// Single-attempt check with a shorter timeout — used for bulk admin queries where retry would be too slow.
export async function checkTelegramSubscriptionOnce(userId: number): Promise<boolean | null> {
  const gatewayUrl = process.env.TELEGRAM_GATEWAY_URL;
  const gatewayKey = process.env.TELEGRAM_GATEWAY_API_KEY;
  if (!gatewayUrl || !gatewayKey) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    let response;
    try {
      response = await fetch(gatewayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Key": gatewayKey },
        body: JSON.stringify({ userId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    const data = await response.json().catch(() => null);
    if (response.ok && data && typeof data.isSubscriber === 'boolean') {
      return data.isSubscriber;
    }
    return null;
  } catch {
    return null;
  }
}
