import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface User {
  id: string;
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  role: "USER" | "AUTHOR" | "ADMIN";
  authorId?: string | null;
  permissions?: string[];
}

export const requestCode = async (
  username: string
): Promise<{ ok: true; devCode?: string; devError?: string }> => {
  const response = await fetch(`${API_URL}/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to request code");
  }

  return response.json();
};

// credentials: 'include' is required to receive the refresh token cookie.
export const verifyCode = async (
  username: string,
  code: string
): Promise<{ token: string; user: User }> => {
  const response = await fetch(`${API_URL}/auth/verify-code`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, code }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Invalid code");
  }

  return response.json();
};

export const getMe = async (): Promise<{ user: User }> => {
  const response = await fetchWithAuth(`${API_URL}/auth/me`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to fetch user");
  }

  return response.json();
};

export const logout = async (): Promise<void> => {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
  } catch {
    // Proceed with local logout even if request fails
  }
};
