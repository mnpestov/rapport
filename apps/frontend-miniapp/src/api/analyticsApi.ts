import { API_URL } from "./config";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { getAuthHeaders } from "./authApi";

const sendAnalyticsEvent = async (endpoint: string, body?: any): Promise<void> => {
  try {
    const headers: Record<string, string> = {
      ...getAuthHeaders(),
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetchWithTimeout(
      `${API_URL}/analytics/${endpoint}`,
      {
        method: "POST",
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      5000 // Short timeout for analytics
    );

    if (!response.ok) {
      console.error(`[Analytics] Failed to send ${endpoint}: ${response.status}`);
    }
  } catch (error) {
    console.error(`[Analytics] Network error sending ${endpoint}:`, error);
  }
};

export const trackPatternView = async (patternId: string): Promise<void> => {
  await sendAnalyticsEvent("pattern-view", { patternId });
};

export const trackPatternLinkClick = async (patternId: string): Promise<void> => {
  await sendAnalyticsEvent("pattern-link-click", { patternId });
};

export const trackSubscribeClick = async (): Promise<void> => {
  await sendAnalyticsEvent("subscribe-click");
};
