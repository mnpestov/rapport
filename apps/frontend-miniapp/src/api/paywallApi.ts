import { API_URL } from "./config";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { getAuthHeaders } from "./authApi";

// Fire-and-forget, same as trackPatternView and the rest of analyticsApi —
// never blocks UI, never surfaces an error to the user on failure. Called
// once when the banner renders, and again with clicked=true if the user
// taps the CTA (PAYWALL_BANNER_PLAN.md §7) — at most twice per banner
// lifecycle.
export const submitPaywallImpression = async (clicked?: boolean): Promise<void> => {
  try {
    const response = await fetchWithTimeout(
      `${API_URL}/analytics/paywall-impression`,
      {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(clicked ? { clicked: true } : {}),
      },
      5000
    );
    if (!response.ok) {
      console.error(`[Paywall] Failed to record impression: ${response.status}`);
    }
  } catch (error) {
    console.error("[Paywall] Network error recording impression:", error);
  }
};
