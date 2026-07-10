import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

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

export type SortField = "firstName" | "lastSeenAt" | "createdAt" | "favoritesCount";
export type SortOrder = "asc" | "desc";

export const getUsers = async (params: {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: SortField;
  sortOrder?: SortOrder;
}): Promise<UsersResponse> => {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  if (params.sortBy) q.set("sortBy", params.sortBy);
  if (params.sortOrder) q.set("sortOrder", params.sortOrder);
  const res = await fetchWithAuth(`${API_URL}/admin/users?${q}`);
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.statusText}`);
  return res.json();
};

export const getUserSubscription = async (telegramId: string): Promise<boolean | null> => {
  const res = await fetchWithAuth(
    `${API_URL}/admin/users/${telegramId}/subscription`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data.isSubscribed === "boolean" ? data.isSubscribed : null;
};
