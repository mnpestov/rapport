import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface AuthorItem {
  id: string;
  name: string;
  site: string | null;
  patternsCount: number;
}

export interface AuthorInput {
  name: string;
  site?: string;
}

export const getAuthors = async (search: string = ""): Promise<AuthorItem[]> => {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const response = await fetchWithAuth(`${API_URL}/admin/authors${query}`);
  if (!response.ok) throw new Error(`Failed to fetch authors: ${response.statusText}`);
  return response.json();
};

export const createAuthor = async (data: AuthorInput): Promise<AuthorItem> => {
  const response = await fetchWithAuth(`${API_URL}/admin/authors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create author: ${response.statusText}`);
  }
  return response.json();
};

export const updateAuthor = async (id: string, data: AuthorInput): Promise<AuthorItem> => {
  const response = await fetchWithAuth(`${API_URL}/admin/authors/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update author: ${response.statusText}`);
  }
  return response.json();
};

export const deleteAuthor = async (id: string): Promise<{ success: boolean }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/authors/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to delete author: ${response.statusText}`);
  }
  return response.json();
};

// --- SYNC API ---

export interface SyncReportItem {
  id: string;
  reportId: string;
  status: string;
  url: string;
  title: string;
  parsedData: any;
}

export interface SyncReport {
  id: string;
  authorId: string;
  status: string;
  items?: SyncReportItem[];
}

export const getPendingReports = async (): Promise<{ id: string; authorId: string; itemsCount: number }[]> => {
  const response = await fetchWithAuth(`${API_URL}/admin/sync-reports`);
  if (!response.ok) throw new Error("Failed to fetch pending reports");
  return response.json();
};

export const getReportById = async (reportId: string): Promise<SyncReport> => {
  const response = await fetchWithAuth(`${API_URL}/admin/sync-reports/${reportId}`);
  if (!response.ok) throw new Error("Failed to fetch report");
  return response.json();
};

export const processSyncBatch = async (reportId: string, items: any[]): Promise<{ processed: number; total: number }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/sync-reports/${reportId}/process-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to process batch");
  }
  return response.json();
};

export const clearSyncReport = async (reportId: string): Promise<{ success: boolean }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/sync-reports/${reportId}/clear`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to clear sync report");
  }
  return response.json();
};

export interface SyncItemUpdateDTO {
  title: string;
  url: string;
  images: string[];
  isFree: boolean;
  isNew: boolean;
  categories: string[];
  tags: string[];
  instruments: string[];
  yarnRangeIds: string[];
  densityStitches: number | string;
  densityRows: number | string;
}

export const updateSyncItem = async (
  itemId: string,
  data: SyncItemUpdateDTO
): Promise<SyncReportItem> => {
  const response = await fetchWithAuth(`${API_URL}/admin/sync-items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update sync item");
  }
  return response.json();
};

export const rejectSyncItem = async (itemId: string): Promise<{ success: boolean }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/sync-items/${itemId}/reject`, {
    method: "POST",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to reject item");
  }
  return response.json();
};

export const getSyncStatus = async (): Promise<{ isRunning: boolean; authorId: string | null }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/sync-status`);
  if (!response.ok) throw new Error("Failed to fetch sync status");
  return response.json();
};

export const checkPendingAuthors = async (): Promise<{ authors: string[] }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/sync-pending`);
  if (!response.ok) throw new Error("Failed to check pending authors");
  return response.json();
};

export const startSync = async (): Promise<{ success: boolean }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/sync-start`, {
    method: "POST",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to start sync");
  }
  return response.json();
};

export const startAuthorSync = async (authorId: string): Promise<{ success: boolean }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/authors/${authorId}/sync-start`, {
    method: "POST",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to start sync");
  }
  return response.json();
};


