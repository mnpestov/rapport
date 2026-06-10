export interface AuthResponse {
  isSubscriber: boolean;
  token?: string;
  user?: {
    telegramId: number;
    firstName: string;
  };
}

import { API_URL } from "./config";

export const authenticate = async (): Promise<AuthResponse> => {
  try {
    const response = await fetch(`${API_URL}/auth/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ initData: "mock" }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data: AuthResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Authentication network error:", error);
    // При сетевой ошибке или недоступности бэкенда считаем, что доступа нет,
    // чтобы безопасно заблокировать контент.
    return { isSubscriber: false };
  }
};
