import { API_URL } from "./config";
import { getAuthHeaders } from "./authApi";

// GET /favorites — fetch patternIds from DB
export const fetchFavorites = async (): Promise<string[]> => {
  const response = await fetch(`${API_URL}/favorites`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to fetch favorites: ${response.status}`);
  const data = await response.json();
  return data.patternIds as string[];
};

// POST /favorites/:patternId — add single favorite
export const addFavorite = async (patternId: string): Promise<void> => {
  const response = await fetch(`${API_URL}/favorites/${patternId}`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to add favorite: ${response.status}`);
};

// DELETE /favorites/:patternId — remove single favorite
export const removeFavorite = async (patternId: string): Promise<void> => {
  const response = await fetch(`${API_URL}/favorites/${patternId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`Failed to remove favorite: ${response.status}`);
};

// POST /favorites/import — bulk import from localStorage on first run
export const importFavorites = async (patternIds: string[]): Promise<number> => {
  const response = await fetch(`${API_URL}/favorites/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ patternIds }),
  });
  if (!response.ok) throw new Error(`Failed to import favorites: ${response.status}`);
  const data = await response.json();
  return data.imported as number;
};
