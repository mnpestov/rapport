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

// --- Author cabinet: login/password (implementation_plan.md §3, §8) ---

// The backend's author-login/password error strings are a stable API
// contract, not user-facing copy (e.g. "Invalid credentials" — see
// authorPasswordController.ts) — deliberately generic on purpose (avoids
// leaking whether a login exists) but in English. Map the ones a user can
// actually hit to Russian; anything unrecognized falls through to the
// caller-provided fallback rather than showing raw English.
const KNOWN_ERROR_TRANSLATIONS: Record<string, string> = {
  "Invalid credentials": "Неверный логин или пароль",
  "Password is too long": "Пароль слишком длинный",
  "Too many failed attempts, try again later": "Слишком много попыток. Попробуйте позже",
  "Author cabinet access not granted": "Доступ к кабинету автора не выдан",
  "Password must be 10-64 characters": "Пароль должен быть от 10 до 64 символов",
  "Password must not match the login": "Пароль не должен совпадать с логином",
  "New password must differ from the current one": "Новый пароль должен отличаться от текущего",
  "Invalid or expired code": "Неверный или просроченный код",
};

async function parseError(response: Response, fallback: string): Promise<never> {
  const errorData = await response.json().catch(() => ({}));
  const raw: string | undefined = errorData.error;
  throw new Error((raw && KNOWN_ERROR_TRANSLATIONS[raw]) || fallback);
}

export type AuthorLoginResult =
  | { mustChangePassword: true; login: string }
  | { mustChangePassword?: false; token: string; user: User };

// credentials: 'include' is required to receive the refresh token cookie
// (only set on the full-session branch — mustChangePassword issues no token).
export const authorLogin = async (
  login: string,
  password: string
): Promise<AuthorLoginResult> => {
  const response = await fetch(`${API_URL}/auth/author-login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      return parseError(
        response,
        retryAfter
          ? `Слишком много попыток. Повторите через ${retryAfter} сек.`
          : "Слишком много попыток. Попробуйте позже."
      );
    }
    return parseError(response, "Неверный логин или пароль");
  }

  return response.json();
};

export const authorChangePassword = async (
  login: string,
  currentPassword: string,
  newPassword: string
): Promise<{ token: string; user: User }> => {
  const response = await fetch(`${API_URL}/auth/author-change-password`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, currentPassword, newPassword }),
  });

  if (!response.ok) {
    return parseError(response, "Не удалось сменить пароль");
  }

  return response.json();
};

export const forgotPassword = async (login: string): Promise<{ ok: true }> => {
  const response = await fetch(`${API_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login }),
  });

  if (!response.ok) {
    return parseError(response, "Не удалось отправить код");
  }

  return response.json();
};

export const resetPassword = async (
  login: string,
  code: string,
  newPassword: string
): Promise<{ ok: true }> => {
  const response = await fetch(`${API_URL}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, code, newPassword }),
  });

  if (!response.ok) {
    return parseError(response, "Не удалось сбросить пароль");
  }

  return response.json();
};
