import { API_URL } from './config';
import { authorizedFetch } from './authSession';

export interface StashSkein {
  id: string;
  yarnId: string;
  yarnNameSnapshot: string;
  brandSnapshot: string | null;
  mPer100gSnapshot: number | null;
  compositionSnapshot: string | null;
  colorName: string | null;
  dyelot: string | null;
  totalWeightG: number;
  currentWeightG: number;
  note: string | null;
  images: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StashSwatch {
  id: string;
  skeinId: string;
  images: string[];
  needleSizeRaw: string | null;
  densityStitchesBefore: string | null;
  densityRowsBefore: string | null;
  densityStitchesAfter: string | null;
  densityRowsAfter: string | null;
  createdAt: string;
}

export interface StashUsage {
  id: string;
  skeinId: string;
  amountG: number;
  needleSizeRaw: string | null;
  projectTitle: string | null;
  patternId: string | null;
  patternTitleSnapshot: string | null;
  patternAuthorSnapshot: string | null;
  finishedPhotos: string[];
  note: string | null;
  createdAt: string;
}

export interface StashSkeinDetail extends StashSkein {
  swatches: StashSwatch[];
  usages: StashUsage[];
}

export interface FetchStashSkeinsResponse {
  items: StashSkein[];
  total: number;
  page: number;
  pageSize: number;
  // Остаток по ВСЕМУ хранилищу (не только текущей странице/фильтру) —
  // независимо от search/archived, стабильная сводка для шапки экрана.
  totalCurrentWeightG: number;
  // Обновлённая модель платного доступа (Figma node-id=1358:21045/1358:21355):
  // хранилище бесплатно всем до freeLimit артикулов, PREMIUM_YARN_STASH
  // снимает лимит и открывает подбор описаний (matches).
  isUnlimited: boolean;
  freeLimit: number;
  totalSkeinCount: number;
}

export interface StashMatchItem {
  id: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  authorName: string;
  instruments: string[];
  matchedBy: ('exact' | 'thickness' | 'density')[];
}

export interface YarnSuggestion {
  id: string;
  name: string;
  brand: string | null;
  mPer100g: number | null;
  composition: string | null;
  normalizedKey: string;
  isGeneric: boolean;
  _count: { patterns: number };
}

function withImageUrls<T extends { images: string[] }>(item: T): T {
  return {
    ...item,
    images: item.images.map((url) => (url.startsWith('/') ? `${API_URL}${url}` : url)),
  };
}

export interface FetchStashSkeinsOptions {
  page?: number;
  search?: string;
  archived?: boolean;
}

export const fetchStashSkeins = async (options: FetchStashSkeinsOptions = {}): Promise<FetchStashSkeinsResponse> => {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  if (options.search) params.set('search', options.search);
  if (options.archived) params.set('archived', '1');

  const response = await authorizedFetch(`${API_URL}/stash/skeins?${params.toString()}`, {}, 10000);
  if (!response.ok) {
    throw new Error(`Failed to fetch stash skeins: ${response.status}`);
  }
  const data: FetchStashSkeinsResponse = await response.json();
  return { ...data, items: data.items.map(withImageUrls) };
};

export const fetchStashSkeinById = async (id: string): Promise<StashSkeinDetail> => {
  const response = await authorizedFetch(`${API_URL}/stash/skeins/${id}`, {}, 10000);
  if (!response.ok) {
    throw new Error(`Failed to fetch stash skein ${id}: ${response.status}`);
  }
  const skein: StashSkeinDetail = await response.json();
  return {
    ...withImageUrls(skein),
    swatches: skein.swatches.map(withImageUrls),
    usages: skein.usages.map((usage) => ({
      ...usage,
      finishedPhotos: usage.finishedPhotos.map((url) => (url.startsWith('/') ? `${API_URL}${url}` : url)),
    })),
  };
};

export interface UpdateStashSkeinPayload {
  images?: string[];
  colorName?: string;
  dyelot?: string;
  note?: string;
  totalWeightG?: number;
}

export const updateStashSkein = async (id: string, payload: UpdateStashSkeinPayload): Promise<StashSkein> => {
  const response = await authorizedFetch(`${API_URL}/stash/skeins/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to update stash skein: ${response.status}`);
  }
  return withImageUrls(await response.json());
};

export interface CreateStashSkeinPayload {
  totalWeightG: number;
  images?: string[];
  colorName?: string;
  dyelot?: string;
  note?: string;
  yarnId?: string;
  newYarnName?: string;
  newYarnBrand?: string;
  newYarnIsGeneric?: boolean;
  newYarnMPer100g?: number;
  newYarnComposition?: string;
}

// Брошено createStashSkein на 403 с code: STASH_LIMIT_REACHED — фронт
// ловит именно этот класс, чтобы показать пейволл-банер, а не общий текст
// ошибки формы.
export class StashLimitReachedError extends Error {
  constructor(public limit: number) {
    super(`Бесплатный лимит ${limit} артикулов пряжи исчерпан`);
  }
}

export const createStashSkein = async (payload: CreateStashSkeinPayload): Promise<StashSkein> => {
  const response = await authorizedFetch(`${API_URL}/stash/skeins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 403 && body?.code === 'STASH_LIMIT_REACHED') {
      throw new StashLimitReachedError(body.limit ?? 10);
    }
    throw new Error(body?.error || `Failed to create stash skein: ${response.status}`);
  }
  return withImageUrls(await response.json());
};

export interface FetchStashMatchesResponse {
  items: StashMatchItem[];
  // Подбор считается и отдаётся ВСЕГДА (реальные карточки) — isLocked не
  // блокирует данные, а говорит фронту, размывать ли карточки и показывать
  // замок вместо перехода по клику (обновлённая модель платного доступа).
  isLocked: boolean;
}

export const fetchStashMatches = async (skeinId: string): Promise<FetchStashMatchesResponse> => {
  const response = await authorizedFetch(`${API_URL}/stash/skeins/${skeinId}/matches`, {}, 10000);
  if (!response.ok) {
    throw new Error(`Failed to fetch stash matches: ${response.status}`);
  }
  const data: { items: StashMatchItem[]; isLocked: boolean } = await response.json();
  const items = data.items.map((item) => ({
    ...item,
    imageUrl: item.imageUrl.startsWith('/') ? `${API_URL}${item.imageUrl}` : item.imageUrl,
    thumbnailUrl: item.thumbnailUrl.startsWith('/') ? `${API_URL}${item.thumbnailUrl}` : item.thumbnailUrl,
  }));
  return { items, isLocked: data.isLocked };
};

export const suggestStashYarns = async (query: string): Promise<YarnSuggestion[]> => {
  const response = await authorizedFetch(`${API_URL}/stash/yarns/suggest?q=${encodeURIComponent(query)}`, {}, 10000);
  if (!response.ok) {
    throw new Error(`Failed to suggest yarns: ${response.status}`);
  }
  const data: { items: YarnSuggestion[] } = await response.json();
  return data.items;
};

// Возвращает ОТНОСИТЕЛЬНЫЙ путь (как отдаёт бэкенд) — именно его, не
// склеенный с API_URL, ожидает validateNewStashImageOrigins на POST/PATCH
// /stash/skeins (isOwnStashUpload проверяет префикс "/uploads/yarn-stash/").
// Для отображения превью склеивай с API_URL по месту использования.
export const deleteStashSkein = async (id: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/stash/skeins/${id}`, { method: 'DELETE' }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to delete stash skein: ${response.status}`);
  }
};

export interface CreateStashSwatchPayload {
  images?: string[];
  needleSizeRaw?: string;
  densityStitchesBefore?: number;
  densityRowsBefore?: number;
  densityStitchesAfter?: number;
  densityRowsAfter?: number;
}

export const createStashSwatch = async (skeinId: string, payload: CreateStashSwatchPayload): Promise<StashSwatch> => {
  const response = await authorizedFetch(`${API_URL}/stash/skeins/${skeinId}/swatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to create swatch: ${response.status}`);
  }
  return withImageUrls(await response.json());
};

export const deleteStashSwatch = async (id: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/stash/swatches/${id}`, { method: 'DELETE' }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to delete swatch: ${response.status}`);
  }
};

export interface LogStashUsagePayload {
  amountG: number;
  needleSizeRaw?: string;
  projectTitle?: string;
  patternId?: string;
  // Ручной ввод описания, которого нет в каталоге (шаг 2, "Добавить
  // вручную") — игнорируются на бэкенде, если patternId указан.
  manualAuthorName?: string;
  manualDescriptionTitle?: string;
  finishedPhotos?: string[];
  note?: string;
}

export const logStashUsage = async (skeinId: string, payload: LogStashUsagePayload): Promise<StashUsage> => {
  const response = await authorizedFetch(`${API_URL}/stash/skeins/${skeinId}/usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to log stash usage: ${response.status}`);
  }
  return response.json();
};

// Отменяет ошибочное списание — атомарно возвращает amountG обратно в
// currentWeightG мотка (backend/stashController.ts::undoUsage), не просто
// удаляет запись.
export const undoStashUsage = async (usageId: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/stash/usage/${usageId}`, { method: 'DELETE' }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to undo stash usage: ${response.status}`);
  }
};

export const uploadStashImage = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('image', file);
  const response = await authorizedFetch(`${API_URL}/stash/upload`, {
    method: 'POST',
    body: formData,
  }, 20000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to upload image: ${response.status}`);
  }
  const data: { url: string } = await response.json();
  return data.url;
};
