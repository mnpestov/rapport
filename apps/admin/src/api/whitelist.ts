import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface WhitelistEntry {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  comment: string | null;
  forceAllow: boolean;
  debugLogging: boolean;
  needsInvestigation: boolean;
  contactedViaBot: boolean;
  lastWhitelistAuthorizationAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface WhitelistEntryInput {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  comment?: string;
  forceAllow?: boolean;
  debugLogging?: boolean;
  needsInvestigation?: boolean;
}

export const getWhitelist = async (search = ""): Promise<WhitelistEntry[]> => {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const response = await fetchWithAuth(`${API_URL}/admin/whitelist${query}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Failed to fetch whitelist: ${response.statusText}`);
  return response.json();
};

export const createWhitelistEntry = async (
  data: WhitelistEntryInput
): Promise<WhitelistEntry> => {
  const response = await fetchWithAuth(`${API_URL}/admin/whitelist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to create entry: ${response.statusText}`);
  }
  return response.json();
};

export const updateWhitelistEntry = async (
  id: string,
  data: Partial<WhitelistEntryInput>
): Promise<WhitelistEntry> => {
  const response = await fetchWithAuth(`${API_URL}/admin/whitelist/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to update entry: ${response.statusText}`);
  }
  return response.json();
};

export const deleteWhitelistEntry = async (id: string): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/whitelist/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to delete entry: ${response.statusText}`);
  }
};

export interface SubscriptionCheckResult {
  telegramId: string;
  isSubscriber: boolean;
  telegramStatus: string | null;
  telegramOk: boolean | null;
  gatewayStatusCode: number | string | null;
  isParticipantIdInvalid: boolean;
  gatewayDurationMs: number | null;
}

export const notifyWhitelistUser = async (id: string): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/whitelist/${id}/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to send notification: ${response.statusText}`);
  }
};

export const checkWhitelistSubscription = async (
  id: string
): Promise<SubscriptionCheckResult> => {
  const response = await fetchWithAuth(
    `${API_URL}/admin/whitelist/${id}/check-subscription`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to check subscription: ${response.statusText}`);
  }
  return response.json();
};
