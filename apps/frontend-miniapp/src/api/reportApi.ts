import { API_URL } from "./config";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { getAuthHeaders } from "./authApi";

// Multipart, not JSON like analyticsApi's sendAnalyticsEvent — carries an
// optional screenshot file. No Content-Type header here: the browser sets
// its own multipart boundary for FormData, an explicit header would break it.
export const submitErrorReport = async (message: string, screenshot: File | null): Promise<boolean> => {
  const formData = new FormData();
  formData.append("message", message);
  if (screenshot) {
    formData.append("screenshot", screenshot);
  }

  try {
    const response = await fetchWithTimeout(
      `${API_URL}/analytics/report-error`,
      {
        method: "POST",
        headers: { ...getAuthHeaders() },
        body: formData,
      },
      20000 // Photo upload over the Telegram gateway can be slow — longer than the 5s analytics timeout.
    );
    return response.ok;
  } catch (error) {
    console.error("[Report] Failed to submit error report:", error);
    return false;
  }
};
