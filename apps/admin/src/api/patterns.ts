import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface AdminPatternItem {
  id: string;
  title: string;
  createdAt: string;
  category: string;
  characteristics: string;
  url: string;
  author: string;
  instrument: string;
  preview: string;
  isVisible: boolean;
  isFree?: boolean;
  isNew: boolean;
  thickness?: string;
  density?: string;
}

export interface GetAdminPatternsResponse {
  items: AdminPatternItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getPatterns = async (
  page: number = 1,
  limit: number = 10,
  status: string = "all",
  search: string = ""
): Promise<GetAdminPatternsResponse> => {
  const query = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    status,
    ...(search ? { search } : {}),
  });

  const response = await fetchWithAuth(
    `${API_URL}/admin/patterns?${query.toString()}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch patterns: ${response.statusText}`);
  }

  return response.json();
};

export interface AdminPatternDetailDTO {
  id: string;
  slug: string;
  title: string;
  url: string;
  imageUrl: string;
  thumbnailUrl: string;
  images: string[];
  details: string | null;
  price: number | string | null;
  oldPrice: number | string | null;
  isFree: boolean;
  isNew: boolean;
  isVisible: boolean;
  densityStitches: number | string | null;
  densityRows: number | string | null;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string };
  categories: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  instruments: { id: string; name: string }[];
  yarnRanges: { id: string; label: string }[];
}

export const getPatternById = async (id: string): Promise<AdminPatternDetailDTO> => {
  const response = await fetchWithAuth(`${API_URL}/admin/patterns/${id}`);

  if (!response.ok) {
    if (response.status === 404) throw new Error("Pattern not found");
    throw new Error(`Failed to fetch pattern: ${response.statusText}`);
  }

  return response.json();
};

export interface AdminPatternUpdateDTO {
  title?: string;
  slug?: string;
  url?: string;
  images?: string[];
  details?: string | null;
  price?: number | string | null;
  oldPrice?: number | string | null;
  isFree?: boolean;
  isNew?: boolean;
  authorName?: string;
  isVisible?: boolean;
  categories?: string[];
  tags?: string[];
  instruments?: string[];
  yarnRangeIds?: string[];
  densityStitches?: number | string;
  densityRows?: number | string;
}

export const updatePatternById = async (
  id: string,
  data: AdminPatternUpdateDTO
): Promise<{ success: boolean; id: string }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/patterns/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to update pattern: ${response.statusText}`);
  }

  return response.json();
};

export interface AdminPatternCreateDTO {
  title: string;
  url: string;
  images: string[];
  details?: string | null;
  price?: number | string | null;
  oldPrice?: number | string | null;
  isFree?: boolean;
  isNew?: boolean;
  isVisible?: boolean;
  authorName: string;
  categories?: string[];
  tags?: string[];
  instruments?: string[];
  yarnRangeIds?: string[];
  densityStitches?: number | string;
  densityRows?: number | string;
}

export const createPattern = async (
  data: AdminPatternCreateDTO
): Promise<{ success: boolean; id: string }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/patterns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to create pattern: ${response.statusText}`);
  }

  return response.json();
};

export const resetAllIsNew = async (): Promise<{ success: boolean; updated: number }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/patterns/reset-new`, {
    method: "POST",
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to reset isNew: ${response.statusText}`);
  }
  return response.json();
};

export const deletePattern = async (id: string): Promise<{ success: boolean }> => {
  const response = await fetchWithAuth(`${API_URL}/admin/patterns/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to delete pattern: ${response.statusText}`);
  }

  return response.json();
};

export interface DictionaryItem {
  id: string;
  name: string;
  patternsCount: number;
}

export const getCategories = async (): Promise<DictionaryItem[]> => {
  const response = await fetchWithAuth(`${API_URL}/admin/categories`);
  if (!response.ok) throw new Error("Failed to fetch categories");
  return response.json();
};

export const getTags = async (): Promise<DictionaryItem[]> => {
  const response = await fetchWithAuth(`${API_URL}/admin/tags`);
  if (!response.ok) throw new Error("Failed to fetch tags");
  return response.json();
};

export const getInstruments = async (): Promise<DictionaryItem[]> => {
  const response = await fetchWithAuth(`${API_URL}/admin/instruments`);
  if (!response.ok) throw new Error("Failed to fetch instruments");
  return response.json();
};

export interface YarnRange {
  id: string;
  label: string;
  minValue: number;
  maxValue: number | null;
}

export const getYarnRanges = async (): Promise<YarnRange[]> => {
  const response = await fetchWithAuth(`${API_URL}/admin/yarn-ranges`);
  if (!response.ok) throw new Error("Failed to fetch yarn ranges");
  return response.json();
};

export const updateCategory = async (id: string, name: string): Promise<DictionaryItem> => {
  const response = await fetchWithAuth(`${API_URL}/admin/categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error("Failed to update category");
  return response.json();
};

export const deleteCategory = async (id: string): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/categories/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete category");
};

export const updateTag = async (id: string, name: string): Promise<DictionaryItem> => {
  const response = await fetchWithAuth(`${API_URL}/admin/tags/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error("Failed to update tag");
  return response.json();
};

export const deleteTag = async (id: string): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/tags/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete tag");
};

export const updateInstrument = async (id: string, name: string): Promise<DictionaryItem> => {
  const response = await fetchWithAuth(`${API_URL}/admin/instruments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error("Failed to update instrument");
  return response.json();
};

export const deleteInstrument = async (id: string): Promise<void> => {
  const response = await fetchWithAuth(`${API_URL}/admin/instruments/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete instrument");
};

export const fixArchiveQuotes = async (): Promise<{ updated: number }> => {
  const response = await fetchWithAuth(
    `${API_URL}/admin/patterns/fix-archive-quotes`,
    { method: "POST" }
  );
  if (!response.ok) throw new Error("Failed to fix quotes");
  return response.json();
};

export const uploadImage = async (file: File): Promise<{ url: string }> => {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetchWithAuth(`${API_URL}/admin/upload`, {
    method: "POST",
    body: formData,
    // No Content-Type — browser sets multipart boundary automatically
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to upload image");
  }

  return response.json();
};
