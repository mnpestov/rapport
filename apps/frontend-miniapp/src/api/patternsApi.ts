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
}

import { API_URL } from "./config";

export const fetchPatterns = async (options?: FetchPatternsOptions): Promise<Pattern[]> => {
  const params = new URLSearchParams();
  
  if (options?.search) params.append("search", options.search);
  if (options?.isFree) params.append("isFree", "true");
  if (options?.isNew) params.append("isNew", "true");
  if (options?.limit !== undefined) params.append("limit", options.limit.toString());
  if (options?.offset !== undefined) params.append("offset", options.offset.toString());

  const queryString = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_URL}/patterns${queryString}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch patterns: ${response.status}`);
  }
  const patterns: Pattern[] = await response.json();
  return patterns.map(p => ({
    ...p,
    imageUrl: p.imageUrl.startsWith('/') ? `${API_URL}${p.imageUrl}` : p.imageUrl
  }));
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
