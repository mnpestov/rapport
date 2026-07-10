import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface ChatMessage {
  id: string;
  direction: "in" | "out";
  messageType: string;
  text: string | null;
  fileId: string | null;
  timestamp: string;
}

export const getChatHistory = async (telegramId: string): Promise<ChatMessage[]> => {
  const res = await fetchWithAuth(`${API_URL}/admin/chat/${telegramId}`);
  if (!res.ok) throw new Error(`Failed to fetch chat: ${res.statusText}`);
  return res.json();
};

export const sendChatMessage = async (
  telegramId: string,
  text: string
): Promise<ChatMessage> => {
  const res = await fetchWithAuth(`${API_URL}/admin/chat/${telegramId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const res = await fetchWithAuth(`${API_URL}/admin/chat/unread`);
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
  const res = await fetchWithAuth(`${API_URL}/admin/requests`);
  if (!res.ok) throw new Error(`Failed to fetch requests: ${res.statusText}`);
  return res.json();
};

export const markChatAsRead = async (telegramId: string): Promise<void> => {
  await fetchWithAuth(`${API_URL}/admin/chat/${telegramId}/read`, {
    method: "PATCH",
  });
};

export function getChatFileUrl(fileId: string): string {
  return `${API_URL}/admin/chat/file/${encodeURIComponent(fileId)}`;
}
