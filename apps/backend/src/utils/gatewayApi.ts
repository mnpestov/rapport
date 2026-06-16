export interface ChannelInfo {
  title: string | null;
  username: string | null;
  photoUrl: string | null;
  subscriberCount: number;
  description: string | null;
}

export async function fetchChannelInfoFromGateway(): Promise<ChannelInfo | null> {
  const gatewayBaseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const gatewayKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  if (!gatewayBaseUrl || !gatewayKey) {
    console.error("[GatewayApi] TELEGRAM_GATEWAY_BASE_URL or TELEGRAM_GATEWAY_API_KEY is not configured.");
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await fetch(`${gatewayBaseUrl}/channel-info`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Gateway-Key": gatewayKey,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.error(`[GatewayApi] Gateway error: HTTP ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data as ChannelInfo;
  } catch (error) {
    console.error(`[GatewayApi] Network error communicating with Gateway for channel info:`, error);
    return null;
  }
}
