export interface Pattern {
  id: string;
  title: string;
  author: string;
  primaryProductType: string;
  imageUrl: string;
  isFree: boolean;
  productTypes: string[];
  instruments: string[];
  tags: string[];
  externalLink: string;
}

export interface FetchPatternsOptions {
  search?: string;
  isFree?: boolean;
  isNew?: boolean;
  limit?: number;
  offset?: number;
  categories?: string[];
  tags?: string[];
  instruments?: string[];
  authors?: string[];
}

export interface FilterOption {
  id: string;
  name: string;
}

export interface FiltersResponse {
  categories: FilterOption[];
  tags: FilterOption[];
  instruments: FilterOption[];
  authors: FilterOption[];
}

import { API_URL } from "./config";

export interface FetchPatternsResponse {
  data: Pattern[];
  total: number;
}

export const fetchPatterns = async (options: FetchPatternsOptions = {}): Promise<FetchPatternsResponse> => {
  const params = new URLSearchParams();
  
  if (options?.search) params.append("search", options.search);
  if (options?.isFree) params.append("isFree", "true");
  if (options?.isNew) params.append("isNew", "true");
  if (options?.limit !== undefined) params.append("limit", options.limit.toString());
  if (options?.offset !== undefined) params.append("offset", options.offset.toString());
  
  if (options?.categories && options.categories.length > 0) {
    options.categories.forEach(c => params.append("categories", c));
  }
  if (options?.tags && options.tags.length > 0) {
    options.tags.forEach(t => params.append("tags", t));
  }
  if (options?.instruments && options.instruments.length > 0) {
    options.instruments.forEach(i => params.append("instruments", i));
  }
  if (options?.authors && options.authors.length > 0) {
    options.authors.forEach(a => params.append("authors", a));
  }

  const queryString = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_URL}/patterns${queryString}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch patterns: ${response.status}`);
  }
  const result: FetchPatternsResponse = await response.json();
  return {
    ...result,
    data: result.data.map(p => ({
      ...p,
      imageUrl: p.imageUrl.startsWith('/') ? `${API_URL}${p.imageUrl}` : p.imageUrl
    }))
  };
};

export const fetchPatternById = async (id: string): Promise<Pattern> => {
  const response = await fetch(`${API_URL}/patterns/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch pattern ${id}: ${response.status}`);
  }
  const pattern: Pattern = await response.json();
  return {
    ...pattern,
    imageUrl: pattern.imageUrl.startsWith('/') ? `${API_URL}${pattern.imageUrl}` : pattern.imageUrl
  };
};

export const fetchFilters = async (): Promise<FiltersResponse> => {
  const response = await fetch(`${API_URL}/filters`);
  if (!response.ok) {
    throw new Error(`Failed to fetch filters: ${response.status}`);
  }
  return response.json();
};

