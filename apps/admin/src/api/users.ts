import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export type UserRole = 'USER' | 'AUTHOR' | 'ADMIN';

export interface AdminUser {
  id: string;
  telegramId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  isPremium: boolean;
  role: UserRole;
  authorId: string | null;
  author: { id: string; name: string } | null;
  createdAt: string;
  lastSeenAt: string | null;
  platform: string | null;
  tgVersion: string | null;
  userAgent: string | null;
  favoritesCount: number;
}

export interface AdminUserDetail extends AdminUser {
  permissions: string[];
  // Исключён ли из статистики воронки подписки — свои и тестовые аккаунты
  // заметно искажают конверсию на малых числах. На основную статистику
  // дашборда флаг не влияет.
  excludeFromStats: boolean;
}

// Вкладки списка пользователей. "paid" = есть любой PREMIUM_* permission.
export type UserFilter = "all" | "paid";

export interface UsersResponse {
  data: AdminUser[];
  total: number;
  counts: { all: number; paid: number };
}

export type SortField = "firstName" | "lastSeenAt" | "createdAt" | "favoritesCount";
export type SortOrder = "asc" | "desc";

export const getUsers = async (params: {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  filter?: UserFilter;
}): Promise<UsersResponse> => {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  if (params.sortBy) q.set("sortBy", params.sortBy);
  if (params.sortOrder) q.set("sortOrder", params.sortOrder);
  if (params.filter && params.filter !== "all") q.set("filter", params.filter);
  const res = await fetchWithAuth(`${API_URL}/admin/users?${q}`);
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.statusText}`);
  return res.json();
};

export const getUserById = async (id: string): Promise<AdminUserDetail> => {
  const res = await fetchWithAuth(`${API_URL}/admin/users/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch user: ${res.statusText}`);
  return res.json();
};

export const updateUser = async (
  id: string,
  data: { role?: UserRole; authorId?: string | null; excludeFromStats?: boolean }
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${API_URL}/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `Failed to update user: ${res.statusText}`);
  }
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

// Thin wrapper over the existing grant/revoke endpoints — no new backend
// needed, see PAID_TIER_PERMISSIONS_PLAN.md §1/§6.
export const syncPermission = async (
  userId: string,
  permission: string,
  wanted: boolean,
  had: boolean
): Promise<void> => {
  if (wanted === had) return;
  if (wanted) {
    const res = await fetchWithAuth(`${API_URL}/admin/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, permission }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `Failed to grant ${permission}: ${res.statusText}`);
    }
  } else {
    const res = await fetchWithAuth(`${API_URL}/admin/permissions/${userId}/${permission}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `Failed to revoke ${permission}: ${res.statusText}`);
    }
  }
};
