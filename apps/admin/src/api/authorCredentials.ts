import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

async function parseError(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

// POST /admin/author-credentials — grant access directly, without an
// AuthorApplication (implementation_plan.md §4.5, §8: "Выдать доступ").
export const grantAuthorCredentials = async (
  userId: string,
  authorId: string
): Promise<{ success: true; login: string }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/author-credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, authorId }),
  });
  if (!response.ok) return parseError(response, "Failed to grant access");
  return response.json();
};

// DELETE /admin/author-credentials/:userId — "Отозвать пароль": removes
// only password-auth, keeps role/AUTHOR_CABINET permission intact.
export const revokePassword = async (userId: string): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/author-credentials/${userId}`, {
    method: "DELETE",
  });
  if (!response.ok) return parseError(response, "Failed to revoke password");
};

// POST /admin/author-credentials/:userId/resend-credentials — issues a
// fresh temp password.
export const resendCredentials = async (userId: string): Promise<{ success: true; login: string }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/author-credentials/${userId}/resend-credentials`, {
    method: "POST",
  });
  if (!response.ok) return parseError(response, "Failed to resend credentials");
  return response.json();
};

// POST /admin/author-credentials/:userId/revoke-access — "Отозвать
// доступ": full revocation (role, permission, credential, sessions).
export const revokeAccess = async (userId: string): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/author-credentials/${userId}/revoke-access`, {
    method: "POST",
  });
  if (!response.ok) return parseError(response, "Failed to revoke access");
};
