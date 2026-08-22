export interface Pattern {
  id: string;
  title: string;
  author: string;
  authorId: string;
  // Only populated by fetchPatternById — used by the detail page's Footer
  // ("Источник информации: ..."), nowhere else needs it.
  authorSite?: string | null;
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
  // Балл популярности (доля открывших описание, которые перешли к автору
  // или добавили его в избранное; пересчитывается на сервере раз в сутки).
  // Каталог по нему сортируется запросом, Избранному он нужен в ответе —
  // там список уже загружен целиком и сортируется на клиенте.
  popularityScore?: number;
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
  // Id counterparts of productTypes/tags/instruments — only present on
  // fetchPatternsByIds' response, for client-side filter matching against
  // FilterModal's id-based SelectedFilters (favorites page). Absent
  // elsewhere (fetchPatterns/fetchSimilarPatterns don't need it — those
  // filter server-side).
  categoryIds?: string[];
  tagIds?: string[];
  instrumentIds?: string[];
  // Only present when the requester has PREMIUM_CORE (mirrors
  // densityStitches/densityRows' own gating) — the yarnRange ids attached to
  // this pattern, for the same client-side filter-matching reason as above.
  // Distinct from `yarnRanges` (labels, fetchPatternById only).
  yarnRangeIds?: string[];
  // The "actually went live" moment — see the field comment in
  // schema.prisma. Always present for a visible pattern (verified on prod:
  // 0 of 3068 NULL), never omitted by any list endpoint even though no
  // Pattern field above declared it before — used by clientPatternFilters'
  // sortPatterns for the favorites page's client-side "Последние
  // добавленные", mirroring what the server now defaults to.
  publishedAt: string;
}

export interface FetchPatternsOptions {
  search?: string;
  isFree?: boolean;
  isNew?: boolean;
  // Server ignores this for non-PREMIUM_EXTRA requests (see getPatterns) —
  // matches price/oldPrice's own gating, so there's nothing to filter by
  // for a tier that never receives those fields in the first place.
  isDiscount?: boolean;
  // 'newest' (publishedAt desc) is the server's own default when omitted —
  // only sent when non-default. price_asc/price_desc silently fall back to
  // 'newest' server-side for non-PREMIUM_EXTRA requests, same reasoning as
  // isDiscount above. 'popular' (число добавлений в избранное) такого гейта
  // не имеет — оно считается по UserFavorite, а не по платным полям.
  sort?: 'newest' | 'popular' | 'price_asc' | 'price_desc';
  // Server ignores both for non-PREMIUM_EXTRA requests, same as isDiscount —
  // doesn't narrow any other facet's option list (see getFilters), only the
  // main pattern list.
  priceMin?: string;
  priceMax?: string;
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
  if (options?.isDiscount) params.append("isDiscount", "true");
  if (options?.sort && options.sort !== "newest") params.append("sort", options.sort);
  if (options?.priceMin) params.append("priceMin", options.priceMin);
  if (options?.priceMax) params.append("priceMax", options.priceMax);
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

// Backend caps a single /patterns/batch request at 500 ids (defensive, not
// tied to any body-size limit — see patternsController.ts comment). Callers
// with more ids than this (confirmed on prod: one user has 522 favorites)
// are expected to chunk, not raise that number.
const BATCH_CHUNK_SIZE = 500;

const fetchPatternsByIdsSingleBatch = async (ids: string[]): Promise<Pattern[]> => {
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

export const fetchPatternsByIds = async (ids: string[]): Promise<Pattern[]> => {
  if (ids.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + BATCH_CHUNK_SIZE));
  }

  // Independent reads — fire in parallel rather than awaiting one chunk
  // before starting the next.
  const results = await Promise.all(chunks.map(fetchPatternsByIdsSingleBatch));
  const byId = new Map(results.flat().map(p => [p.id, p]));
  // Reassemble in the caller's original id order, not chunk-arrival order —
  // matches how the backend already orders a single chunk's own response.
  return ids.map(id => byId.get(id)).filter((p): p is Pattern => p !== undefined);
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
