export interface AuthResponse {
  isSubscriber: boolean;
  token?: string;
  user?: {
    id: string;
    telegramId: string;
    firstName: string;
    // Drives premium-only UI (see usePremiumAccess) — not a permission
    // boundary by itself, the backend already omits premium data for
    // anyone without the matching PREMIUM_CORE/PREMIUM_EXTRA permission
    // regardless of what the frontend renders.
    role?: "USER" | "AUTHOR" | "ADMIN";
    permissions?: string[];
  };
}

import { API_URL } from "./config";
import { fetchWithTimeout } from "./fetchWithTimeout";

const isNetworkError = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof Error && error.name === "AbortError");

const attemptAuth = async (initData: string): Promise<AuthResponse> => {
  const response = await fetchWithTimeout(`${API_URL}/auth/telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  }, 8000);
  if (!response.ok) throw new Error(`Server error: ${response.status}`);
  return response.json();
};

const saveAuthData = (data: AuthResponse) => {
  if (data.token) {
    localStorage.setItem("jwt_token", data.token);
    window.dispatchEvent(new CustomEvent("auth:ready"));
  }
  if (data.user) {
    localStorage.setItem("user_data", JSON.stringify(data.user));
  }
};

export const authenticate = async (initData: string): Promise<AuthResponse> => {
  try {
    const data = await attemptAuth(initData);
    saveAuthData(data);
    return data;
  } catch (firstError) {
    if (!isNetworkError(firstError)) {
      console.error("[Auth] Authentication error:", firstError);
      localStorage.removeItem("jwt_token");
      localStorage.removeItem("user_data");
      return { isSubscriber: false };
    }

    console.warn("[Auth] Network error, retrying in 1500ms:", firstError);
    console.log("[AUTH_RETRY] auth_retry_started");
    await new Promise<void>(resolve => setTimeout(resolve, 1500));

    try {
      const data = await attemptAuth(initData);
      console.log("[AUTH_RETRY] auth_retry_success");
      saveAuthData(data);
      return data;
    } catch (retryError) {
      console.error("[AUTH_RETRY] auth_retry_failed:", retryError);
      localStorage.removeItem("jwt_token");
      localStorage.removeItem("user_data");
      return { isSubscriber: false };
    }
  }
};

// Helper to get auth headers for API calls
export const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("jwt_token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
};
