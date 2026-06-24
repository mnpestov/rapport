import { API_URL } from "./config";

export interface User {
  id: string;
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  role: "USER" | "AUTHOR" | "ADMIN";
}

export const requestCode = async (username: string): Promise<{ ok: true; devCode?: string; devError?: string }> => {
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

export const verifyCode = async (
  username: string,
  code: string
): Promise<{ token: string; user: User }> => {
  const response = await fetch(`${API_URL}/auth/verify-code`, {
    method: "POST",
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
  const token = localStorage.getItem("jwt_token");
  if (!token) throw new Error("No token");

  const response = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to fetch user");
  }

  return response.json();
};
