import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface PriceCheckChange {
  author: string;
  title: string;
  url: string;
  oldPrice: number | null;
  oldOldPrice: number | null;
  newPrice: number | null;
  newOldPrice: number | null;
}

export interface PriceCheckError {
  author: string;
  // null for author-level failures (author not found, store handler down)
  // — not tied to one pattern, nothing to link to.
  title: string | null;
  url: string | null;
  error: string;
}

export interface PriceCheckEscalation {
  author: string;
  title: string | null;
  url: string;
  runs: number;
}

export interface PriceCheckRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  checked: number;
  changed: number;
  errorsCount: number;
  changes: PriceCheckChange[];
  errors: PriceCheckError[];
  escalations: PriceCheckEscalation[];
  createdAt: string;
}

export const getPriceCheckRuns = async (): Promise<PriceCheckRun[]> => {
  const response = await fetchWithAuth(`${API_URL}/admin/price-check-runs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch price check runs: ${response.statusText}`);
  }
  const { data } = await response.json();
  return data;
};

export const getPriceCheckStatus = async (): Promise<{ isRunning: boolean }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/price-check-runs/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch price check status: ${response.statusText}`);
  }
  return response.json();
};

export const getConfirmedAuthors = async (): Promise<string[]> => {
  const response = await fetchWithAuth(`${API_URL}/admin/price-check-runs/confirmed-authors`);
  if (!response.ok) {
    throw new Error(`Failed to fetch confirmed authors: ${response.statusText}`);
  }
  const { authors } = await response.json();
  return authors;
};

// authors omitted/empty — все CONFIRMED_AUTHORS (как раньше).
export const triggerPriceCheck = async (authors?: string[]): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/price-check-runs/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authors && authors.length > 0 ? { authors } : {}),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to trigger price check: ${response.statusText}`);
  }
};
