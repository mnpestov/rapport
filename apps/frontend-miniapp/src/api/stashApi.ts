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
  strandsCount: number | null;
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

// Заявка владельца на дозаполнение метража/состава справочного артикула
// (yarnId), пока она ждёт рассмотрения — не даём подать вторую поверх
// первой, показываем "на рассмотрении" вместо формы.
export interface PendingYarnFieldSuggestion {
  id: string;
  mPer100g: number | null;
  composition: string | null;
}

export interface StashSkeinDetail extends StashSkein {
  swatches: StashSwatch[];
  usages: StashUsage[];
  pendingYarnFieldSuggestion: PendingYarnFieldSuggestion | null;
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
  // Первая категория описания — карточка "Что можно связать" в
  // StashSkeinDetails.tsx показывает название/категорию/инструмент.
  category: string | null;
  matchedBy: ('exact' | 'thickness' | 'density')[];
  // Заполнено, только когда совпадение по толщине нашлось при сложении в
  // несколько нитей (matchedBy содержит 'thickness') — карточка
  // подписывается "При вязании в N сложений". null — сложение не при чём.
  strandsCount: number | null;
}

export interface YarnSuggestion {
  // Отсутствует у Ravelry-preview вариантов (ravelryId задан вместо) —
  // запись ещё не создана в нашей БД, выбор такой подсказки должен
  // сначала импортировать её через importRavelryYarn(ravelryId), а не
  // сразу заполнять форму как для обычной подсказки.
  id?: string;
  // Задан только у Ravelry-preview вариантов — до 5 штук, как и сам поиск
  // Ravelry отдаёт (не 1, как было раньше: пряжу типа "Homespun" делают
  // сразу 5+ разных брендов, показывать только первый результат не давало
  // пользователю выбрать нужный).
  ravelryId?: number;
  name: string;
  brand: string | null;
  mPer100g: number | null;
  composition: string | null;
  normalizedKey: string;
  isGeneric: boolean;
  _count: { patterns: number };
  // true — карточка создана/дозаполнена Ravelry, либо это ещё не
  // импортированный preview-вариант — фронт подписывает такую подсказку
  // "Данные с Ravelry".
  fromRavelry: boolean;
  // Справочное фото (своё или скачанное из Ravelry) — предзаполняет
  // images мотка при выборе этой подсказки в AddYarnModal. Относительный
  // URL, тот же формат, что uploadStashImage() возвращает при обычной
  // загрузке — см. suggestStashYarns ниже.
  photoUrl: string | null;
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
  // Есть ли ещё страницы после этой — фронт использует для автодогрузки по
  // скроллу (без кнопки "показать ещё"), см. StashSkeinDetails.tsx.
  hasMore: boolean;
}

// offset=0 (по умолчанию) — первая страница (20 карточек на бэкенде),
// offset>0 — следующие страницы (по 10). Сам размер страницы решает
// backend (stashController.ts::getMatches) — фронт только передаёт offset.
export const fetchStashMatches = async (skeinId: string, offset = 0): Promise<FetchStashMatchesResponse> => {
  const response = await authorizedFetch(`${API_URL}/stash/skeins/${skeinId}/matches?offset=${offset}`, {}, 10000);
  if (!response.ok) {
    throw new Error(`Failed to fetch stash matches: ${response.status}`);
  }
  const data: { items: StashMatchItem[]; isLocked: boolean; hasMore: boolean } = await response.json();
  const items = data.items.map((item) => ({
    ...item,
    imageUrl: item.imageUrl.startsWith('/') ? `${API_URL}${item.imageUrl}` : item.imageUrl,
    thumbnailUrl: item.thumbnailUrl.startsWith('/') ? `${API_URL}${item.thumbnailUrl}` : item.thumbnailUrl,
  }));
  return { items, isLocked: data.isLocked, hasMore: data.hasMore };
};

export interface SuggestStashYarnsResult {
  items: YarnSuggestion[];
  // true — есть ещё Ravelry-результаты дальше (следующая страница) — см.
  // page ниже, инфинити-скролл в списке подсказок AddYarnModal.
  hasMoreFromRavelry: boolean;
}

export const suggestStashYarns = async (
  query: string,
  // page — только для Ravelry-части (наш справочник не постранично, см.
  // комментарий над suggestYarns в stashController.ts). brand — значение
  // соседнего поля "Бренд" в форме, если уже заполнено: поднимает
  // совпадения по бренду вверх списка Ravelry-результатов.
  options: { page?: number; brand?: string } = {}
): Promise<SuggestStashYarnsResult> => {
  const params = new URLSearchParams({ q: query });
  if (options.page != null) params.set('page', String(options.page));
  if (options.brand) params.set('brand', options.brand);
  const response = await authorizedFetch(`${API_URL}/stash/yarns/suggest?${params.toString()}`, {}, 10000);
  if (!response.ok) {
    throw new Error(`Failed to suggest yarns: ${response.status}`);
  }
  const data: { items: YarnSuggestion[]; hasMoreFromRavelry: boolean } = await response.json();
  // photoUrl остаётся ОТНОСИТЕЛЬНЫМ, как и есть с бэкенда — тот же формат,
  // что uploadStashImage() возвращает при обычной загрузке фото: AddYarnModal
  // рендерит images напрямую (<img src={url}>) без API_URL-префикса, и при
  // сабмите в createStashSkein ожидается тот же относительный путь.
  return { items: data.items, hasMoreFromRavelry: data.hasMoreFromRavelry };
};

// Шаг 2 Ravelry-фолбэка — вызывается, когда пользователь ЯВНО выбрал один
// из preview-вариантов (YarnSuggestion.ravelryId без id) в подсказках
// suggestStashYarns. Создаёт (или находит уже созданную) запись в нашем
// справочнике; ДО этого выбора запись не существует — иначе выбор не того
// из нескольких вариантов с одинаковым названием блокировал бы доступ к
// остальным (unique-конфликт при повторном fallback на тот же запрос).
export const importRavelryYarn = async (ravelryId: number): Promise<YarnSuggestion> => {
  const response = await authorizedFetch(`${API_URL}/stash/yarns/import-ravelry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ravelryId }),
  }, 15000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to import yarn from Ravelry: ${response.status}`);
  }
  return response.json();
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
  strandsCount?: number;
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

export const updateStashSwatch = async (id: string, payload: CreateStashSwatchPayload): Promise<StashSwatch> => {
  const response = await authorizedFetch(`${API_URL}/stash/swatches/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to update swatch: ${response.status}`);
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

// amountG сознательно нет — вес списания не редактируется (см. комментарий
// у updateUsage на бэкенде), только описательные поля.
export interface UpdateStashUsagePayload {
  needleSizeRaw?: string;
  projectTitle?: string;
  patternId?: string;
  manualAuthorName?: string;
  manualDescriptionTitle?: string;
  finishedPhotos?: string[];
  note?: string;
}

export const updateStashUsage = async (usageId: string, payload: UpdateStashUsagePayload): Promise<StashUsage> => {
  const response = await authorizedFetch(`${API_URL}/stash/usage/${usageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to update stash usage: ${response.status}`);
  }
  return response.json();
};

export interface SuggestYarnFieldsPayload {
  mPer100g?: number;
  composition?: string;
}

// Заявка на дозаполнение метража/состава справочного артикула, на который
// ссылается конкретный моток пользователя — уходит на модерацию (админка →
// Пряжа → «Заявки на дозаполнение»), не меняет справочник напрямую.
export const suggestYarnFields = async (skeinId: string, payload: SuggestYarnFieldsPayload): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/stash/skeins/${skeinId}/suggest-yarn-fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to suggest yarn fields: ${response.status}`);
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
