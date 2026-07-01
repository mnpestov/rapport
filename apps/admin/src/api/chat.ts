import { API_URL } from "./config";

export interface ChatMessage {
  id: string;
  direction: "in" | "out";
  messageType: string;
  text: string | null;
  fileId: string | null;
  timestamp: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("jwt_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const getChatHistory = async (telegramId: string): Promise<ChatMessage[]> => {
  const res = await fetch(`${API_URL}/admin/chat/${telegramId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch chat: ${res.statusText}`);
  return res.json();
};

export const sendChatMessage = async (telegramId: string, text: string): Promise<ChatMessage> => {
  const res = await fetch(`${API_URL}/admin/chat/${telegramId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `Failed to send message: ${res.statusText}`);
  }
  return res.json();
};

interface UnreadGroup {
  total: number;
  users: { telegramId: string; unreadCount: number }[];
}

export interface UnreadInfo {
  all: UnreadGroup;
  whitelist: UnreadGroup;
}

export const getUnreadMessages = async (): Promise<UnreadInfo> => {
  const res = await fetch(`${API_URL}/admin/chat/unread`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch unread: ${res.statusText}`);
  return res.json();
};

export interface RequestUser {
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastMessageAt: string;
  lastMessageText: string | null;
  lastMessageType: string;
  unreadCount: number;
  isWhitelisted: boolean;
  isSubscribed: boolean | null;
}

export const getRequests = async (): Promise<RequestUser[]> => {
  const res = await fetch(`${API_URL}/admin/requests`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch requests: ${res.statusText}`);
  return res.json();
};

export const markChatAsRead = async (telegramId: string): Promise<void> => {
  await fetch(`${API_URL}/admin/chat/${telegramId}/read`, {
    method: "PATCH",
    headers: authHeaders(),
  });
};

export const getChatFileUrl = (fileId: string): string => {
  const token = localStorage.getItem("jwt_token") ?? "";
  return `${API_URL}/admin/chat/file/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`;
};
