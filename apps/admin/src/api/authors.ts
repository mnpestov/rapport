import { API_URL } from "./config";

export interface AuthorItem {
  id: string;
  name: string;
  patternsCount: number;
}

export const getAuthors = async (search: string = ""): Promise<AuthorItem[]> => {
  const token = localStorage.getItem("jwt_token");
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  
  const response = await fetch(`${API_URL}/admin/authors${query}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch authors: ${response.statusText}`);
  }

  return response.json();
};

export const createAuthor = async (name: string): Promise<AuthorItem> => {
  const token = localStorage.getItem("jwt_token");

  const response = await fetch(`${API_URL}/admin/authors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to create author: ${response.statusText}`);
  }

  return response.json();
};

export const updateAuthor = async (id: string, name: string): Promise<AuthorItem> => {
  const token = localStorage.getItem("jwt_token");

  const response = await fetch(`${API_URL}/admin/authors/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to update author: ${response.statusText}`);
  }

  return response.json();
};

export const deleteAuthor = async (id: string): Promise<{ success: boolean }> => {
  const token = localStorage.getItem("jwt_token");

  const response = await fetch(`${API_URL}/admin/authors/${id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to delete author: ${response.statusText}`);
  }

  return response.json();
};
