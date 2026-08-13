export interface Pattern {
  id: string;
  title: string;
  author: string;
  authorId: string;
  primaryProductType: string;
  imageUrl: string;
  // Card-sized (≤800px) derivative of imageUrl — falls back to imageUrl
  // server-side while not yet backfilled, so always present. Use this for
  // card/list contexts (catalog, favorites, "Похожие описания"); imageUrl
  // itself stays full quality — it's what the detail page falls back to
  // when `images` is empty (non-premium users), see PatternDetails.tsx.
  thumbnailUrl: string;
  isFree: boolean;
  isNew: boolean;
  productTypes: string[];
  instruments: string[];
  tags: string[];
  externalLink: string;
  // Only populated by fetchPatternById — the list/by-ids endpoints don't
  // include yarnRanges (not shown on catalog cards), hence optional here.
  densityStitches?: string | null;
  densityRows?: string | null;
  yarnRanges?: string[];
  // Gallery — only populated by fetchPatternById, same reasoning as above.
  // Always has at least one entry (the cover, same value as imageUrl).
  images?: string[];
  // Long-form "Подробности" text — only populated by fetchPatternById
  // (omitted from list/by-ids responses, same reasoning as images).
  details?: string | null;
  // Present everywhere (list, by-ids, detail) — unlike images/details these
  // are two small numbers, no payload-size reason to omit from lists, and
  // catalog cards show price too. oldPrice set only when a discount is
  // actually active (oldPrice > price); no separate boolean/percent field.
  price?: string | null;
  oldPrice?: string | null;
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
  yarnRanges?: string[];
  density?: string[];
  signal?: AbortSignal;
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
  yarnRanges: FilterOption[];
  density: FilterOption[];
}

import { API_URL } from "./config";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { getAuthHeaders } from "./authApi";

export interface FetchPatternsResponse {
  data: Pattern[];
  total: number;
}

const capitalize = (str: string) => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

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
  if (options?.yarnRanges && options.yarnRanges.length > 0) {
    options.yarnRanges.forEach(y => params.append("yarnRanges", y));
  }
  if (options?.density && options.density.length > 0) {
    options.density.forEach(d => params.append("density", d));
  }

  const queryString = params.toString() ? `?${params.toString()}` : "";
  const response = await fetchWithTimeout(`${API_URL}/patterns${queryString}`, { signal: options.signal, headers: getAuthHeaders() }, 10000);
  if (!response.ok) {
    throw new Error(`Failed to fetch patterns: ${response.status}`);
  }
  const result: FetchPatternsResponse = await response.json();
  return {
    ...result,
    data: result.data.map(p => ({
      ...p,
      primaryProductType: capitalize(p.primaryProductType),
      productTypes: p.productTypes?.map(capitalize) || [],
      imageUrl: p.imageUrl.startsWith('/') ? `${API_URL}${p.imageUrl}` : p.imageUrl,
      thumbnailUrl: p.thumbnailUrl.startsWith('/') ? `${API_URL}${p.thumbnailUrl}` : p.thumbnailUrl
    }))
  };
};

export const fetchPatternById = async (id: string): Promise<Pattern> => {
  const response = await fetchWithTimeout(`${API_URL}/patterns/${id}`, { headers: getAuthHeaders() }, 10000);
  if (!response.ok) {
    throw new Error(`Failed to fetch pattern ${id}: ${response.status}`);
  }
  const pattern: Pattern = await response.json();
  return {
    ...pattern,
    primaryProductType: capitalize(pattern.primaryProductType),
    productTypes: pattern.productTypes?.map(capitalize) || [],
    imageUrl: pattern.imageUrl.startsWith('/') ? `${API_URL}${pattern.imageUrl}` : pattern.imageUrl,
    thumbnailUrl: pattern.thumbnailUrl.startsWith('/') ? `${API_URL}${pattern.thumbnailUrl}` : pattern.thumbnailUrl,
    images: (pattern.images && pattern.images.length > 0 ? pattern.images : [pattern.imageUrl])
      .map(url => url.startsWith('/') ? `${API_URL}${url}` : url)
  };
};

export interface FetchFiltersOptions {
  categories?: string[];
  tags?: string[];
  instruments?: string[];
  authors?: string[];
  yarnRanges?: string[];
  density?: string[];
  signal?: AbortSignal;
}

export const fetchFilters = async (options: FetchFiltersOptions = {}): Promise<FiltersResponse> => {
  const params = new URLSearchParams();

  if (options.categories && options.categories.length > 0) {
    options.categories.forEach(c => params.append("categories", c));
  }
  if (options.tags && options.tags.length > 0) {
    options.tags.forEach(t => params.append("tags", t));
  }
  if (options.instruments && options.instruments.length > 0) {
    options.instruments.forEach(i => params.append("instruments", i));
  }
  if (options.authors && options.authors.length > 0) {
    options.authors.forEach(a => params.append("authors", a));
  }
  if (options.yarnRanges && options.yarnRanges.length > 0) {
    options.yarnRanges.forEach(y => params.append("yarnRanges", y));
  }
  if (options.density && options.density.length > 0) {
    options.density.forEach(d => params.append("density", d));
  }

  const queryString = params.toString() ? `?${params.toString()}` : "";
  const response = await fetchWithTimeout(`${API_URL}/filters${queryString}`, { signal: options.signal, headers: getAuthHeaders() }, 10000);
  if (!response.ok) {
    throw new Error(`Failed to fetch filters: ${response.status}`);
  }
  const data: FiltersResponse = await response.json();
  return {
    ...data,
    categories: data.categories.map(c => ({ ...c, name: capitalize(c.name) }))
  };
};

export const fetchPatternsByIds = async (ids: string[]): Promise<Pattern[]> => {
  if (ids.length === 0) return [];

  const response = await fetchWithTimeout(`${API_URL}/patterns/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ ids }),
  }, 10000);

  if (!response.ok) {
    throw new Error(`Failed to fetch patterns batch: ${response.status}`);
  }

  const { data }: { data: Pattern[] } = await response.json();
  return data.map(p => ({
    ...p,
    primaryProductType: capitalize(p.primaryProductType),
    productTypes: p.productTypes?.map(capitalize) || [],
    imageUrl: p.imageUrl.startsWith('/') ? `${API_URL}${p.imageUrl}` : p.imageUrl,
    thumbnailUrl: p.thumbnailUrl.startsWith('/') ? `${API_URL}${p.thumbnailUrl}` : p.thumbnailUrl
  }));
};

// "Похожие описания" on the detail page — server-side tiered matching by
// category + characteristics (see patternsController.getSimilarPatterns).
export const fetchSimilarPatterns = async (id: string): Promise<Pattern[]> => {
  const response = await fetchWithTimeout(`${API_URL}/patterns/${id}/similar`, { headers: getAuthHeaders() }, 10000);
  if (!response.ok) {
    throw new Error(`Failed to fetch similar patterns: ${response.status}`);
  }

  const { data }: { data: Pattern[] } = await response.json();
  return data.map(p => ({
    ...p,
    primaryProductType: capitalize(p.primaryProductType),
    productTypes: p.productTypes?.map(capitalize) || [],
    imageUrl: p.imageUrl.startsWith('/') ? `${API_URL}${p.imageUrl}` : p.imageUrl,
    thumbnailUrl: p.thumbnailUrl.startsWith('/') ? `${API_URL}${p.thumbnailUrl}` : p.thumbnailUrl
  }));
};
