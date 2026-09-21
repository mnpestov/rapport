/**
 * Fallback на Ravelry API для поиска пряжи в личном хранилище (не для
 * общего справочника — см. suggestStashYarns в stashController.ts).
 *
 * Двухшаговый флоу — важно, что запись в НАШЕЙ БД не создаётся сразу по
 * результату поиска:
 *   1. searchRavelryPreview(query) — просто ищет в Ravelry, показывает
 *      пользователю ДО 5 вариантов (как и сам Ravelry), ничего не пишет в
 *      БД. Раньше здесь сразу создавалась карточка по первому результату —
 *      если пользователь искал многозначное название ("Homespun" — 5+
 *      разных пряж пяти разных брендов на Ravelry) и выбирал не тот
 *      единственный вариант, вернуться к остальным было уже нельзя: наш
 *      поиск не видит PENDING-карточки (фильтрует строго APPROVED), а
 *      повторный fallback упирался в тот же normalizedKey/ravelryId
 *      (unique constraint) и молча возвращал пусто.
 *   2. importRavelryYarn(ravelryId) — вызывается ТОЛЬКО когда пользователь
 *      явно выбрал конкретный вариант в подсказках; вот тут уже создаётся
 *      (или дозаполняется, см. enrichExistingYarn) запись в БД.
 *
 * Импортированное сохраняется как status: PENDING, createdVia:
 * STASH_USER — тот же модерационный поток, что и ручной ввод пользователя
 * (YARN_STASH_PLAN.md §5.4): Ravelry — доверенный источник, но не настолько,
 * чтобы публиковать в общий справочник без проверки модератором.
 */
import path from "path";
import { Prisma, YarnStatus } from "@prisma/client";
import { prisma } from "../prismaClient";
import { normalizeYarnKey, yarnDedupKey } from "../utils/yarnKeys";
import { normalizeUploadedImage } from "../utils/imagePipeline";
import {
  searchRavelryYarns,
  getRavelryYarnDetail,
  toMPer100g,
  formatComposition,
} from "./ravelryClient";

const YARN_STASH_IMAGES_DIR = path.join(__dirname, "../../uploads/yarn-stash");

// Не блокируем автокомплит пользователя из-за медленной/недоступной
// Ravelry — best-effort, тот же принцип, что у generateVariantUrl в
// imagePipeline.ts (деградация без ошибки в ответе API).
async function downloadRavelryPhoto(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = await normalizeUploadedImage(buffer, YARN_STASH_IMAGES_DIR);
    return `/uploads/yarn-stash/${filename}`;
  } catch (error) {
    console.error("[ravelryYarnFallback] Failed to download photo:", error);
    return null;
  }
}

interface YarnLike {
  id: string;
  mPer100g: number | null;
  composition: string | null;
  photoUrl: string | null;
}

// Дозаполняет ТОЛЬКО пустые поля существующей записи — Ravelry не
// перетирает то, что уже было проверено/введено раньше (тот же принцип,
// что у approveYarnFieldSuggestion: "обновляет только если поле ещё
// пусто"). Фото — отдельный пустой критерий от metraжа/состава: запись
// может уже иметь оба текстовых поля заполненными (кем-то введены вручную
// или другим импортом), но так и остаться без фото, если тот более ранний
// источник фото не предоставлял.
async function enrichExistingYarn(yarn: YarnLike, ravelryId: number): Promise<boolean> {
  const needsMPer100g = yarn.mPer100g == null;
  const needsComposition = yarn.composition == null;
  const needsPhoto = yarn.photoUrl == null;
  if (!needsMPer100g && !needsComposition && !needsPhoto) return false;

  const detail = await getRavelryYarnDetail(ravelryId);
  const data: Prisma.YarnUpdateInput = {};
  if (needsMPer100g) {
    const mPer100g = toMPer100g(detail.yardage, detail.grams);
    if (mPer100g != null) data.mPer100g = mPer100g;
  }
  if (needsComposition) {
    const composition = formatComposition(detail.yarn_fibers);
    if (composition != null) data.composition = composition;
  }
  if (needsPhoto) {
    const photo = detail.photos[0];
    if (photo) {
      const photoUrl = await downloadRavelryPhoto(photo.medium2_url || photo.medium_url);
      if (photoUrl != null) data.photoUrl = photoUrl;
    }
  }
  if (Object.keys(data).length === 0) return false;

  await prisma.yarn.update({ where: { id: yarn.id }, data });
  return true;
}

export interface RavelryPreviewYarn {
  // ravelryId, НЕ наш id — записи ещё нет в БД, выбор конкретного варианта
  // импортирует её через importRavelryYarn(ravelryId).
  ravelryId: number;
  name: string;
  brand: string | null;
}

export interface RavelryPreviewPage {
  items: RavelryPreviewYarn[];
  hasMore: boolean;
}

/**
 * Шаг 1 — просто показывает варианты, ничего не пишет в БД. Показывается
 * ВСЕГДА рядом со своими результатами (см. комментарий в
 * suggestYarns/stashController.ts), не только когда своих 0. page — для
 * infinite scroll в подсказках: 30 штук за раз (RAVELRY_PAGE_SIZE в
 * ravelryClient.ts), фронт запрашивает следующую страницу по доскроллу до
 * конца списка.
 */
export async function searchRavelryPreview(query: string, page = 1): Promise<RavelryPreviewPage> {
  const { yarns, hasMore } = await searchRavelryYarns(query, page);
  return {
    items: yarns.map((r) => ({
      ravelryId: r.id,
      name: r.yarn_company_name ? `${r.yarn_company_name} ${r.name}` : r.name,
      brand: r.yarn_company_name,
    })),
    hasMore,
  };
}

export interface RavelryFallbackYarn {
  id: string;
  name: string;
  brand: string | null;
  mPer100g: number | null;
  composition: string | null;
  photoUrl: string | null;
}

/**
 * Шаг 2 — вызывается ТОЛЬКО когда пользователь явно выбрал конкретный
 * вариант из searchRavelryPreview. Создаёт запись в БД (или возвращает
 * уже существующую с тем же ravelryId — идемпотентно на повторный выбор
 * того же варианта, не только на первый импорт).
 */
export async function importRavelryYarn(ravelryId: number): Promise<RavelryFallbackYarn | null> {
  const existing = await prisma.yarn.findUnique({
    where: { ravelryId },
    select: { id: true, name: true, brand: true, mPer100g: true, composition: true, photoUrl: true },
  });
  if (existing) return existing;

  const detail = await getRavelryYarnDetail(ravelryId);
  const name = detail.yarn_company ? `${detail.yarn_company.name} ${detail.name}` : detail.name;
  const normalizedKey = normalizeYarnKey(name);

  try {
    const photo = detail.photos[0];
    const photoUrl = photo ? await downloadRavelryPhoto(photo.medium2_url || photo.medium_url) : null;

    return await prisma.yarn.create({
      data: {
        name,
        brand: detail.yarn_company?.name ?? null,
        normalizedKey,
        dedupKey: yarnDedupKey(name),
        mPer100g: toMPer100g(detail.yardage, detail.grams),
        composition: formatComposition(detail.yarn_fibers),
        needleMinMm: detail.min_needle_size?.metric ?? null,
        needleMaxMm: detail.max_needle_size?.metric ?? null,
        sourceName: "Ravelry",
        sourceUrl: `https://www.ravelry.com/yarns/library/${detail.permalink}`,
        ravelryId: detail.id,
        photoUrl,
        status: YarnStatus.PENDING,
        createdVia: "STASH_USER",
      },
      select: { id: true, name: true, brand: true, mPer100g: true, composition: true, photoUrl: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Гонка: два пользователя импортировали один ravelryId одновременно,
      // либо normalizedKey совпал с записью, созданной ДРУГИМ способом
      // (ручной ввод/другой ravelryId с тем же итоговым именем) — второй
      // случай реален и требует внимания модератора, а не тихого пропуска,
      // поэтому логируем оба варианта одинаково.
      console.warn(`[ravelryYarnFallback] Yarn with normalizedKey=${normalizedKey} or ravelryId=${ravelryId} already exists — returning existing record.`);
      const byKey = await prisma.yarn.findFirst({
        where: { OR: [{ normalizedKey }, { ravelryId }] },
        select: { id: true, name: true, brand: true, mPer100g: true, composition: true, photoUrl: true },
      });
      return byKey;
    }
    throw error;
  }
}

/**
 * Дозаполнение существующей записи нашего справочника (не Ravelry-
 * preview) — используется отдельно от импорта нового варианта, см.
 * enrichExistingYarn выше. Ищет в Ravelry по имени и берёт первый
 * результат как наиболее вероятное совпадение — тут выбора вариантов не
 * нужно, только дополняющие данные к записи, которую пользователь уже и
 * так выбрал из нашего справочника.
 */
export async function enrichYarnFromRavelrySearch(yarn: YarnLike, query: string): Promise<boolean> {
  const { yarns } = await searchRavelryYarns(query);
  if (yarns.length === 0) return false;
  return enrichExistingYarn(yarn, yarns[0].id);
}
