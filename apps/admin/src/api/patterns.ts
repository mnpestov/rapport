import { API_URL } from "./config";

export interface AdminPatternItem {
  id: string;
  title: string;
  createdAt: string; // Date comes as ISO string
  category: string;
  characteristics: string;
  url: string;
  author: string;
  instrument: string;
  preview: string;
  isVisible: boolean;
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
  const token = localStorage.getItem("jwt_token");
  
  const query = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    status,
    ...(search ? { search } : {})
  });

  const response = await fetch(`${API_URL}/admin/patterns?${query.toString()}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

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
  isFree: boolean;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
  };
  categories: {
    id: string;
    name: string;
  }[];
  tags: {
    id: string;
    name: string;
  }[];
  instruments: {
    id: string;
    name: string;
  }[];
}

export const getPatternById = async (id: string): Promise<AdminPatternDetailDTO> => {
  const token = localStorage.getItem("jwt_token");

  const response = await fetch(`${API_URL}/admin/patterns/${id}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Pattern not found");
    }
    throw new Error(`Failed to fetch pattern: ${response.statusText}`);
  }

  return response.json();
};

export interface AdminPatternUpdateDTO {
  title?: string;
  slug?: string;
  url?: string;
  imageUrl?: string;
  isFree?: boolean;
  authorName?: string;
  isVisible?: boolean;
  categories?: string[];
  tags?: string[];
  instruments?: string[];
}

export const updatePatternById = async (id: string, data: AdminPatternUpdateDTO): Promise<{ success: boolean; id: string }> => {
  const token = localStorage.getItem("jwt_token");

  const response = await fetch(`${API_URL}/admin/patterns/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
  imageUrl: string;
  isFree?: boolean;
  authorName: string;
  categories?: string[];
  tags?: string[];
  instruments?: string[];
}

export const createPattern = async (data: AdminPatternCreateDTO): Promise<{ success: boolean; id: string }> => {
  const token = localStorage.getItem("jwt_token");

  const response = await fetch(`${API_URL}/admin/patterns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to create pattern: ${response.statusText}`);
  }

  return response.json();
};

export const deletePattern = async (id: string): Promise<{ success: boolean }> => {
  const token = localStorage.getItem("jwt_token");

  const response = await fetch(`${API_URL}/admin/patterns/${id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
}

export const getCategories = async (): Promise<DictionaryItem[]> => {
  const token = localStorage.getItem("jwt_token");
  const response = await fetch(`${API_URL}/admin/categories`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new Error("Failed to fetch categories");
  return response.json();
};

export const getTags = async (): Promise<DictionaryItem[]> => {
  const token = localStorage.getItem("jwt_token");
  const response = await fetch(`${API_URL}/admin/tags`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new Error("Failed to fetch tags");
  return response.json();
};

export const getInstruments = async (): Promise<DictionaryItem[]> => {
  const token = localStorage.getItem("jwt_token");
  const response = await fetch(`${API_URL}/admin/instruments`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new Error("Failed to fetch instruments");
  return response.json();
};

export const uploadImage = async (file: File): Promise<{ url: string }> => {
  const token = localStorage.getItem("jwt_token");
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`${API_URL}/admin/upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to upload image");
  }

  return response.json();
};
