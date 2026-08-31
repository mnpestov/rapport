import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export interface YarnAliasItem {
  id: string;
  alias: string;
}

export interface YarnItem {
  id: string;
  brand: string | null;
  line: string | null;
  name: string;
  isGeneric: boolean;
  mPer100g: number | null;
  composition: string | null;
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
  status: "PENDING" | "APPROVED";
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
}): Promise<{ items: YarnItem[]; total: number; page: number; pageSize: number }> => {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.page) qs.set("page", String(params.page));
  if (params.noMetrage) qs.set("noMetrage", "1");
  if (params.generic) qs.set("generic", "1");
  if (params.pending) qs.set("pending", "1");
  return json(await fetchWithAuth(`${API_URL}/admin/yarns?${qs}`));
};

export const suggestYarns = async (q: string): Promise<{ items: YarnSuggestItem[] }> =>
  json(await fetchWithAuth(`${API_URL}/admin/yarns/suggest?q=${encodeURIComponent(q)}`));

export const createYarn = async (data: Partial<YarnItem>): Promise<YarnItem> =>
  json(
    await fetchWithAuth(`${API_URL}/admin/yarns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );

export const updateYarn = async (id: string, data: Partial<YarnItem>): Promise<YarnItem> =>
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

// POST /author/yarns — тот же контракт, что createYarn, но status всегда
// PENDING на бэкенде вне зависимости от переданных данных.
export const createAuthorYarn = async (data: Partial<YarnItem>): Promise<YarnItem> =>
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
