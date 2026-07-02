import { API_URL } from "./config";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("jwt_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface AdminUser {
  id: string;
  telegramId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  isPremium: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  platform: string | null;
  tgVersion: string | null;
  userAgent: string | null;
  favoritesCount: number;
}

export interface UsersResponse {
  data: AdminUser[];
  total: number;
}

export const getUsers = async (params: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<UsersResponse> => {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  const res = await fetch(`${API_URL}/admin/users?${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.statusText}`);
  return res.json();
};

export const getUserSubscription = async (telegramId: string): Promise<boolean | null> => {
  const res = await fetch(`${API_URL}/admin/users/${telegramId}/subscription`, { headers: authHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data.isSubscribed === "boolean" ? data.isSubscribed : null;
};
