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

export interface WinbackResponseInfo {
  id: string;
  reason: "DIDNT_FIND_PATTERN" | "HARD_TO_USE" | "ALL_GOOD";
  createdAt: string;
  // null для ALL_GOOD (там нет запроса текста) и для случаев, когда
  // пользователь нажал кнопку, но так и не написал свободный текст.
  feedbackText: string | null;
  isRead: boolean;
}

// Одна строка — один пользователь, кому отправлен чекин (не одна строка на
// ответ): видно и тех, кто ещё не ответил (response: null), чтобы была
// понятна вся картина отправок, не только реакции.
export interface WinbackSendItem {
  userId: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  sentAt: string;
  optedOut: boolean;
  response: WinbackResponseInfo | null;
}

export const getWinbackResponses = async (): Promise<WinbackSendItem[]> => {
  const res = await fetchWithAuth(`${API_URL}/admin/winback-responses`);
  if (!res.ok) throw new Error(`Failed to fetch winback responses: ${res.statusText}`);
  return res.json();
};

export const markWinbackResponseAsRead = async (responseId: string): Promise<void> => {
  await fetchWithAuth(`${API_URL}/admin/winback-responses/${responseId}/read`, {
    method: "PATCH",
  });
};

export const getUnreadWinbackCount = async (): Promise<number> => {
  const res = await fetchWithAuth(`${API_URL}/admin/winback-responses/unread-count`);
  if (!res.ok) throw new Error(`Failed to fetch unread winback count: ${res.statusText}`);
  const data = await res.json();
  return data.count;
};

export const markChatAsRead = async (telegramId: string): Promise<void> => {
  await fetchWithAuth(`${API_URL}/admin/chat/${telegramId}/read`, {
    method: "PATCH",
  });
};

export function getChatFileUrl(fileId: string): string {
  return `${API_URL}/admin/chat/file/${encodeURIComponent(fileId)}`;
}
