import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface AuthorItem {
  id: string;
  name: string;
  patternsCount: number;
}

export const getAuthors = async (search: string = ""): Promise<AuthorItem[]> => {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const response = await fetchWithAuth(`${API_URL}/admin/authors${query}`);
  if (!response.ok) throw new Error(`Failed to fetch authors: ${response.statusText}`);
  return response.json();
};

export const createAuthor = async (name: string): Promise<AuthorItem> => {
  const response = await fetchWithAuth(`${API_URL}/admin/authors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to create author: ${response.statusText}`);
  }
  return response.json();
};

export const updateAuthor = async (id: string, name: string): Promise<AuthorItem> => {
  const response = await fetchWithAuth(`${API_URL}/admin/authors/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to update author: ${response.statusText}`);
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
