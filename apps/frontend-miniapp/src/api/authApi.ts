export interface AuthResponse {
  isSubscriber: boolean;
  token?: string;
  user?: {
    id: string;
    telegramId: string;
    firstName: string;
  };
}

import { API_URL } from "./config";

export const authenticate = async (initData: string): Promise<AuthResponse> => {
  try {
    const response = await fetch(`${API_URL}/auth/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ initData }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data: AuthResponse = await response.json();
    
    // Save token and user details for future requests
    if (data.token) {
      localStorage.setItem("jwt_token", data.token);
    }
    if (data.user) {
      localStorage.setItem("user_data", JSON.stringify(data.user));
    }

    return data;
  } catch (error) {
    console.error("[Auth] Authentication network error:", error);
    // Remove token on auth failure
    localStorage.removeItem("jwt_token");
    localStorage.removeItem("user_data");
    
    return { isSubscriber: false };
  }
};

// Helper to get auth headers for API calls
export const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("jwt_token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
};
