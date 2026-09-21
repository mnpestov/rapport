/**
 * Клиент Ravelry API (Read-only Personal, Basic Auth) — используется как
 * fallback-источник при поиске пряжи в личном хранилище: пользователь
 * ищет "Malabrigo Rios", у нас в справочнике либо совсем ничего, либо
 * запись есть, но метраж/состав пусты — в обоих случаях идём за данными
 * в Ravelry (см. suggestYarns в yarnsController.ts).
 *
 * Учётка выдана на developer.ravelry.com, read-only Personal access —
 * не OAuth: мы не действуем от лица пользователей Ravelry, только читаем
 * их публичный справочник пряжи.
 */
const RAVELRY_API_BASE = "https://api.ravelry.com";

function authHeader(): string {
  const username = process.env.RAVELRY_API_USERNAME;
  const password = process.env.RAVELRY_API_PASSWORD;
  if (!username || !password) {
    throw new Error("RAVELRY_API_USERNAME/RAVELRY_API_PASSWORD not configured");
  }
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

export interface RavelrySearchResult {
  id: number;
  name: string;
  yarn_company_name: string | null;
  yardage: number | null;
  grams: number | null;
}

export interface RavelryFiber {
  percentage: number;
  fiber_type: { name: string };
}

export interface RavelryPhoto {
  medium_url: string;
  medium2_url?: string;
}

export interface RavelryYarnDetail {
  id: number;
  name: string;
  permalink: string;
  yardage: number | null;
  grams: number | null;
  yarn_company: { name: string } | null;
  yarn_fibers: RavelryFiber[];
  min_needle_size: { metric: number } | null;
  max_needle_size: { metric: number } | null;
  // ВАЖНО: детальный эндпоинт /yarns/{id}.json отдаёт массив "photos", НЕ
  // "first_photo" (то поле есть только в ответе /yarns/search.json) —
  // подтверждено живым запросом, не документацией. Первый элемент — тот же
  // формат объекта, что first_photo в поиске.
  photos: RavelryPhoto[];
}

const YARDS_TO_METERS = 0.9144;

// Ravelry отдаёт метраж на весь моток (yardage при grams граммах), у нас —
// метраж на 100г. Без grams конвертация не имеет смысла (разные бренды
// мотают мотки разного веса) — в этом случае просто нет данных.
export function toMPer100g(yardage: number | null, grams: number | null): number | null {
  if (yardage == null || grams == null || grams <= 0) return null;
  const metersTotal = yardage * YARDS_TO_METERS;
  return Math.round((metersTotal / grams) * 100);
}

export function formatComposition(fibers: RavelryFiber[]): string | null {
  if (!fibers || fibers.length === 0) return null;
  return fibers
    .map((f) => `${f.percentage}% ${f.fiber_type.name}`)
    .join(", ");
}

async function ravelryFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${RAVELRY_API_BASE}${path}`, {
    headers: { Authorization: authHeader() },
  });
  if (!response.ok) {
    throw new Error(`Ravelry API ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface RavelrySearchPage {
  yarns: RavelrySearchResult[];
  // true, если есть ещё страницы после этой — фронт использует для
  // infinite scroll в подсказках (подгружать дальше, только пока есть что).
  hasMore: boolean;
}

const RAVELRY_PAGE_SIZE = 30;

// Поиск по названию — та же точка входа, что пользователь видит в
// подсказках нашего справочника. page — 1-based, как у самого Ravelry API
// (paginator.page), не 0-based.
export async function searchRavelryYarns(query: string, page = 1): Promise<RavelrySearchPage> {
  const q = encodeURIComponent(query);
  const data = await ravelryFetch<{ yarns: RavelrySearchResult[]; paginator?: { page: number; last_page: number } }>(
    `/yarns/search.json?query=${q}&page=${page}&page_size=${RAVELRY_PAGE_SIZE}`
  );
  const yarns = data.yarns ?? [];
  const hasMore = data.paginator ? data.paginator.page < data.paginator.last_page : false;
  return { yarns, hasMore };
}

export async function getRavelryYarnDetail(id: number): Promise<RavelryYarnDetail> {
  const data = await ravelryFetch<{ yarn: RavelryYarnDetail }>(`/yarns/${id}.json`);
  return data.yarn;
}
