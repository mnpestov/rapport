import type { ApplicationStatus } from "@knitting/shared";
import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface AuthorApplication {
  id: string;
  authorName: string;
  resources: string[];
  status: ApplicationStatus;
  adminComment: string | null;
  createdAt: string;
  processedAt: string | null;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    telegramId: string;
  };
}

async function parseError(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

// The backend only special-cases an omitted `status` (defaults to PENDING —
// the actionable queue, not the full history, implementation_plan.md §4.3)
// or a value matching the ApplicationStatus enum; anything else — including
// "ALL" — falls through its filter untouched and returns every application.
// So "ALL" here must still be sent as an explicit, unrecognized query value,
// not omitted (omitting it would silently re-narrow to PENDING).
export const getAuthorApplications = async (
  status?: ApplicationStatus | "ALL"
): Promise<AuthorApplication[]> => {
  const query = status ? `?status=${status}` : "";
  const response = await fetchWithAuth(`${API_URL}/admin/author-applications${query}`);
  if (!response.ok) return parseError(response, "Failed to fetch applications");
  return response.json();
};

export const approveAuthorApplication = async (
  id: string,
  data: { authorId?: string; createAuthorName?: string; login?: string }
): Promise<{ success: true; login: string }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/author-applications/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) return parseError(response, "Failed to approve application");
  return response.json();
};

export const requestApplicationInfo = async (id: string, comment: string): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/author-applications/${id}/needs-info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment }),
  });
  if (!response.ok) return parseError(response, "Failed to request info");
};

export const rejectAuthorApplication = async (id: string, comment?: string): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/author-applications/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment }),
  });
  if (!response.ok) return parseError(response, "Failed to reject application");
};
