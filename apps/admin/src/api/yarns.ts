import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface YarnAliasItem {
  id: string;
  alias: string;
}

// Каноническое волокно из справочника FiberType — базовое волокно
// обязательно, остальные атрибуты уточняют его и часто пусты (у половины
// composition в источнике указано только базовое волокно без подробностей).
export interface FiberTypeItem {
  id: string;
  baseFiber: string;
  subtype: string | null;
  grade: string | null;
  treatment: string | null;
  origin: string | null;
  displayName: string;
}

export interface YarnCompositionItem {
  id: string;
  percentage: number | null;
  fiberType: FiberTypeItem;
}

export interface YarnItem {
  id: string;
  brand: string | null;
  line: string | null;
  name: string;
  isGeneric: boolean;
  mPer100g: number | null;
  composition: string | null;
  compositions: YarnCompositionItem[];
  needleSizeRaw: string | null;
  densityRaw: string | null;
  ballWeightG: number | null;
  ballLengthM: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  isActive: boolean;
  mergedIntoId: string | null;
  // PENDING — создан автором через POST /author/yarns, ждёт проверки, не
  // виден в suggestYarns. APPROVED — default, включая всё созданное админом.
  // REJECTED — отклонённая личная заявка из хранилища пряжи, остаётся
  // видимой владельцу, но не в справочнике (YARN_STASH_PLAN.md §5.1).
  status: "PENDING" | "APPROVED" | "REJECTED";
  // Источник заявки — AUTHOR (узкий проверенный круг через /author/yarns)
  // или STASH_USER (личное хранилище пряжи через /stash/yarns, потенциально
  // массовый источник опечаток/дублей — план §5.4). Бейдж в очереди
  // модерации.
  createdVia: "AUTHOR" | "STASH_USER";
  aliases: YarnAliasItem[];
  _count: { patterns: number };
}

export interface YarnSuggestItem {
  id: string;
  name: string;
  normalizedKey: string;
  brand: string | null;
  mPer100g: number | null;
  composition: string | null;
  isGeneric: boolean;
  _count: { patterns: number };
}

export interface PatternYarnLink {
  id: string;
  source: "SCRAPER" | "ADMIN" | "BACKFILL";
  matchRule: string | null;
  rawMention: string | null;
  metrageInText: string | null;
  yarn: {
    id: string;
    name: string;
    brand: string | null;
    mPer100g: number | null;
    composition: string | null;
    isGeneric: boolean;
  };
}

export interface PatternYarnMentionItem {
  id: string;
  rawText: string;
  metrageInText: string | null;
  kind: "FAMILY" | "BRAND_ONLY" | "UNKNOWN_ARTICLE";
  suggestedYarnId: string | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // Ошибки этого API осмысленные и предназначены человеку («Артикул связан
    // с 12 описаниями»), поэтому текст с сервера важнее статуса.
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || res.statusText);
  }
  return res.json();
}

export const getYarns = async (params: {
  q?: string;
  page?: number;
  noMetrage?: boolean;
  generic?: boolean;
  pending?: boolean;
  createdVia?: "AUTHOR" | "STASH_USER";
}): Promise<{ items: YarnItem[]; total: number; page: number; pageSize: number }> => {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.page) qs.set("page", String(params.page));
  if (params.noMetrage) qs.set("noMetrage", "1");
  if (params.generic) qs.set("generic", "1");
  if (params.pending) qs.set("pending", "1");
  if (params.createdVia) qs.set("createdVia", params.createdVia);
  return json(await fetchWithAuth(`${API_URL}/admin/yarns?${qs}`));
};

export const suggestYarns = async (q: string): Promise<{ items: YarnSuggestItem[] }> =>
  json(await fetchWithAuth(`${API_URL}/admin/yarns/suggest?q=${encodeURIComponent(q)}`));

export const getYarnBrands = async (q?: string): Promise<{ items: string[] }> =>
  json(await fetchWithAuth(`${API_URL}/admin/yarns/brands${q ? `?q=${encodeURIComponent(q)}` : ``}`));

export const getYarnLines = async (q?: string): Promise<{ items: string[] }> =>
  json(await fetchWithAuth(`${API_URL}/admin/yarns/lines${q ? `?q=${encodeURIComponent(q)}` : ``}`));

export const getFiberTypes = async (q?: string): Promise<{ items: FiberTypeItem[] }> =>
  json(await fetchWithAuth(`${API_URL}/admin/fiber-types${q ? `?q=${encodeURIComponent(q)}` : ``}`));

// Создаёт новое волокно в справочнике (или возвращает уже существующее с
// тем же displayName — идемпотентно на серверной стороне) прямо из формы
// одобрения пряжи, когда нужного волокна ещё нет в словаре.
export const createFiberType = async (data: {
  baseFiber: string;
  subtype?: string | null;
  grade?: string | null;
  treatment?: string | null;
  origin?: string | null;
}): Promise<FiberTypeItem> =>
  json(
    await fetchWithAuth(`${API_URL}/admin/fiber-types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );

export const createYarn = async (data: YarnUpdatePayload): Promise<YarnItem> =>
  json(
    await fetchWithAuth(`${API_URL}/admin/yarns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );

// compositions отдельно от Partial<YarnItem>: ответ сервера содержит
// вложенный fiberType-объект, а запрос принимает только fiberTypeId —
// это разные формы одних данных, смешивать их в одном типе только
// запутает вызывающий код.
export type YarnUpdatePayload = Partial<Omit<YarnItem, "compositions">> & {
  compositions?: { fiberTypeId: string; percentage: number | null }[];
};

export const updateYarn = async (id: string, data: YarnUpdatePayload): Promise<YarnItem> =>
  json(
    await fetchWithAuth(`${API_URL}/admin/yarns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );

export const deleteYarn = async (id: string): Promise<void> => {
  await json(await fetchWithAuth(`${API_URL}/admin/yarns/${id}`, { method: "DELETE" }));
};

export const mergeYarn = async (id: string, targetId: string): Promise<void> => {
  await json(
    await fetchWithAuth(`${API_URL}/admin/yarns/${id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId }),
    }),
  );
};

// Очередь модерации (implementation_plan_moderation_yarns_articles.md §3) —
// одобрить/отклонить артикул, созданный автором через createAuthorYarn.
export const approveYarn = async (id: string): Promise<YarnItem> =>
  json(await fetchWithAuth(`${API_URL}/admin/yarns/${id}/approve`, { method: "PATCH" }));

export const rejectPendingYarn = async (id: string): Promise<void> => {
  await json(await fetchWithAuth(`${API_URL}/admin/yarns/${id}/reject`, { method: "PATCH" }));
};

// Заявки на дозаполнение метража/состава уже существующего (APPROVED)
// артикула — предложены владельцами личного хранилища пряжи. Отдельная
// очередь от Yarn.status PENDING выше: та про новые артикулы, эта про
// дельта-правки к живым записям.
export interface YarnFieldSuggestionItem {
  id: string;
  yarnId: string;
  mPer100g: number | null;
  composition: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  yarn: { id: string; name: string; brand: string | null; mPer100g: number | null; composition: string | null };
  suggestedBy: { id: string; firstName: string; lastName: string | null; username: string | null };
}

export const getYarnFieldSuggestions = async (): Promise<YarnFieldSuggestionItem[]> =>
  json(await fetchWithAuth(`${API_URL}/admin/yarn-field-suggestions`));

export const approveYarnFieldSuggestion = async (id: string): Promise<void> => {
  await json(await fetchWithAuth(`${API_URL}/admin/yarn-field-suggestions/${id}/approve`, { method: "PATCH" }));
};

export const rejectYarnFieldSuggestion = async (id: string): Promise<void> => {
  await json(await fetchWithAuth(`${API_URL}/admin/yarn-field-suggestions/${id}/reject`, { method: "PATCH" }));
};

// POST /author/yarns — тот же контракт, что createYarn, но status всегда
// PENDING на бэкенде вне зависимости от переданных данных.
export const createAuthorYarn = async (data: YarnUpdatePayload): Promise<YarnItem> =>
  json(
    await fetchWithAuth(`${API_URL}/author/yarns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );

export const getPatternYarns = async (
  patternId: string,
): Promise<{ links: PatternYarnLink[]; mentions: PatternYarnMentionItem[] }> =>
  json(await fetchWithAuth(`${API_URL}/admin/patterns/${patternId}/yarns`));

export const setPatternYarns = async (patternId: string, yarnIds: string[]): Promise<void> => {
  await json(
    await fetchWithAuth(`${API_URL}/admin/patterns/${patternId}/yarns`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yarnIds }),
    }),
  );
};

export const resolveMention = async (mentionId: string, yarnId: string | null): Promise<void> => {
  await json(
    await fetchWithAuth(`${API_URL}/admin/yarn-mentions/${mentionId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yarnId }),
    }),
  );
};

export interface YarnStats {
  patternsWithDetails: number;
  patternsWithYarn: number;
  links: number;
  linksByRule: { rule: string; count: number }[];
  mentionsByKind: { kind: string; count: number }[];
  genericLinks: { name: string; count: number }[];
  staleLinks: number;
  brandLevelNoLongerPassing: number;
  topUnresolved: { rawText: string; kind: string; count: number }[];
}

export const getYarnStats = async (): Promise<YarnStats> =>
  json(await fetchWithAuth(`${API_URL}/admin/yarn-stats`));
