export interface AuthResponse {
  isSubscriber: boolean;
  token?: string;
  user?: {
    telegramId: number;
    firstName: string;
  };
}

export const authenticate = async (): Promise<AuthResponse> => {
  try {
    const response = await fetch("http://localhost:3000/auth/telegram", {
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
