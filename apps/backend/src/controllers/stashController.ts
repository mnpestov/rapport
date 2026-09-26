/**
 * Личное хранилище пряжи пользователя (YARN_STASH_PLAN.md). Гейтится
 * PREMIUM_YARN_STASH на уровне роутера (routes/stash.ts) — здесь этот факт
 * уже проверен, каждый хендлер получает req.user.userId и (для :id-роутов)
 * req.skein через loadOwnedSkein.
 *
 * *Snapshot-поля на StashSkein — единственный источник для отображения
 * (план §5.12): GET /stash/skeins и GET /stash/skeins/:id читают ТОЛЬКО
 * StashSkein, без join на Yarn — карточка пряжи не должна "тихо" меняться
 * вслед за правками модератора в справочнике, пока владелец сам не
 * запросит обновление явным действием (в v1 такого действия ещё нет).
 */
import { Request, Response } from "express";
import { Prisma, YarnStatus, UserRole, Permission } from "@prisma/client";
import { prisma } from "../prismaClient";
import { normalizeYarnKey, yarnDedupKey } from "../utils/yarnKeys";
import { createAuthorYarn } from "./yarnsController";
import { scoreComposition, loadSubstituteIndex } from "../utils/compositionMatch";
import {
  searchRavelryPreview,
  importRavelryYarn,
  enrichYarnFromRavelrySearch,
} from "../services/ravelryYarnFallback";
import {
  MAX_STASH_IMAGES_PER_SKEIN,
  MAX_STASH_IMAGES_PER_SWATCH,
  validateNewStashImageOrigins,
} from "../utils/stashImages";

const PAGE_SIZE = 20;

// Бесплатный лимит артикулов пряжи на пользователя (обновлённая модель —
// хранилище доступно всем, PREMIUM_YARN_STASH снимает лимит и открывает
// подбор описаний, Figma node-id=1358:21045/1358:21355). Считает ВСЕ
// записи, включая архивные (currentWeightG === 0) — списание мотка в ноль
// не освобождает место в лимите.
export const FREE_STASH_SKEIN_LIMIT = 10;

// Роль читается из БД, никогда из req.user (JwtPayload не содержит role —
// тот же класс бага, что уже задокументирован в loadOwnedSkein.ts).
async function hasUnlimitedStashAccess(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      permissions: { where: { permission: Permission.PREMIUM_YARN_STASH }, select: { id: true } },
    },
  });
  return user?.role === UserRole.ADMIN || (user?.permissions.length ?? 0) > 0;
}

// ─── Мотки/партии (StashSkein) ──────────────────────────────────────────

const SKEIN_SELECT = {
  id: true,
  yarnId: true,
  yarnNameSnapshot: true,
  brandSnapshot: true,
  mPer100gSnapshot: true,
  compositionSnapshot: true,
  colorName: true,
  dyelot: true,
  totalWeightG: true,
  currentWeightG: true,
  note: true,
  images: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StashSkeinSelect;

/**
 * GET /stash/skeins — список мотков пользователя, пагинированный (план §3,
 * тот же паттерн page/pageSize, что listYarns уже использует).
 *
 * Query:
 * - `search` — подстрока по названию/бренду артикула (снимок, не live-join
 *   на Yarn — тот же принцип "снимок как единственный источник для отображения
 *   и поиска в хранилище", что и у остальных полей SKEIN_SELECT).
 * - `archived` — "1" показывает только пряжу с нулевым остатком (архив, по
 *   решению пользователя — нет отдельного поля статуса, архив вычисляется из
 *   currentWeightG). Без параметра — всё, КРОМЕ архивной (текущий остаток
 *   > 0), чтобы полностью использованная пряжа не засоряла основной список.
 */
export const listSkeins = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const page = Math.max(1, Number(req.query.page) || 1);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const archived = req.query.archived === "1" || req.query.archived === "true";

  const where: Prisma.StashSkeinWhereInput = {
    userId,
    currentWeightG: archived ? 0 : { gt: 0 },
    ...(search
      ? {
          OR: [
            { yarnNameSnapshot: { contains: search, mode: "insensitive" } },
            { brandSnapshot: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  try {
    const [items, total, weightAgg, unlimited, totalSkeinCount] = await Promise.all([
      prisma.stashSkein.findMany({
        where,
        select: SKEIN_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.stashSkein.count({ where }),
      // Остаток по ВСЕМУ хранилищу (не только текущей странице и не
      // ограниченный search/archived) — "Общий вес пряжи" в шапке экрана
      // должен быть стабильной сводкой, а не значением, скачущим при вводе
      // в поиск или переключении вкладки "Архив".
      prisma.stashSkein.aggregate({
        where: { userId, currentWeightG: { gt: 0 } },
        _sum: { currentWeightG: true },
      }),
      hasUnlimitedStashAccess(userId),
      // Счётчик для лимита — ВСЕ записи пользователя (не ограниченные
      // search/archived), тот же принцип, что и у totalCurrentWeightG выше.
      prisma.stashSkein.count({ where: { userId } }),
    ]);
    res.json({
      items,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalCurrentWeightG: weightAgg._sum.currentWeightG ?? 0,
      isUnlimited: unlimited,
      freeLimit: FREE_STASH_SKEIN_LIMIT,
      totalSkeinCount,
    });
  } catch (error) {
    console.error("[Stash] listSkeins failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /stash/skeins — добавить моток/партию. Принимает ЛИБО yarnId
 * (артикул уже в справочнике, любой статус — APPROVED/PENDING/REJECTED, всё
 * равно копируется снимком), ЛИБО newYarnName (+ опциональные newYarnBrand/
 * newYarnMPer100g/newYarnComposition) для нового PENDING-артикула, созданного
 * тем же путём, что и авторская заявка (createAuthorYarn), но с
 * createdVia: STASH_USER (план §5.4).
 */
export const createSkein = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const body = req.body ?? {};

  const totalWeightG = Number(body.totalWeightG);
  if (!Number.isFinite(totalWeightG) || totalWeightG <= 0) {
    res.status(400).json({ error: "totalWeightG must be a positive number" });
    return;
  }

  const unlimited = await hasUnlimitedStashAccess(userId);
  if (!unlimited) {
    const existingCount = await prisma.stashSkein.count({ where: { userId } });
    if (existingCount >= FREE_STASH_SKEIN_LIMIT) {
      res.status(403).json({
        error: `Бесплатный лимит ${FREE_STASH_SKEIN_LIMIT} артикулов пряжи исчерпан`,
        code: "STASH_LIMIT_REACHED",
        limit: FREE_STASH_SKEIN_LIMIT,
      });
      return;
    }
  }

  const images: string[] = Array.isArray(body.images) ? body.images.map(String) : [];
  if (images.length > MAX_STASH_IMAGES_PER_SKEIN) {
    res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото на моток` });
    return;
  }
  const originsCheck = validateNewStashImageOrigins(images);
  if (!originsCheck.ok) {
    res.status(400).json({ error: originsCheck.error });
    return;
  }

  const yarnId = typeof body.yarnId === "string" ? body.yarnId : null;
  const newYarnName = typeof body.newYarnName === "string" ? body.newYarnName.trim() : "";

  if (!yarnId && !newYarnName) {
    res.status(400).json({ error: "Either yarnId or newYarnName is required" });
    return;
  }

  try {
    let yarn: {
      id: string;
      name: string;
      brand: string | null;
      mPer100g: number | null;
      composition: string | null;
    } | null = null;

    if (yarnId) {
      yarn = await prisma.yarn.findUnique({
        where: { id: yarnId },
        select: { id: true, name: true, brand: true, mPer100g: true, composition: true },
      });
      if (!yarn) {
        res.status(404).json({ error: "Yarn not found" });
        return;
      }
    } else {
      // Тот же путь создания, что и авторская заявка (createAuthorYarn),
      // включая проверку дублей по normalizedKey (409) — только
      // createdVia: STASH_USER, чтобы очередь модерации видела источник.
      const normalizedKey = normalizeYarnKey(newYarnName);
      const existing = await prisma.yarn.findUnique({
        where: { normalizedKey },
        select: { id: true, name: true },
      });
      if (existing) {
        res.status(409).json({
          error: `Такой артикул уже есть: «${existing.name}»`,
          id: existing.id,
        });
        return;
      }
      const isGeneric = Boolean(body.newYarnIsGeneric);
      const brand = body.newYarnBrand ? String(body.newYarnBrand).trim() : null;
      if (!isGeneric && !brand) {
        res.status(400).json({ error: "Укажите бренд или отметьте карточку родовой" });
        return;
      }
      const created = await prisma.yarn.create({
        data: {
          name: newYarnName,
          brand,
          isGeneric,
          mPer100g:
            body.newYarnMPer100g == null || body.newYarnMPer100g === ""
              ? null
              : Number(body.newYarnMPer100g),
          composition: body.newYarnComposition ? String(body.newYarnComposition) : null,
          normalizedKey,
          dedupKey: yarnDedupKey(newYarnName),
          status: YarnStatus.PENDING,
          createdVia: "STASH_USER",
        },
        select: { id: true, name: true, brand: true, mPer100g: true, composition: true },
      });
      yarn = created;
    }

    const skein = await prisma.stashSkein.create({
      data: {
        userId,
        yarnId: yarn.id,
        yarnNameSnapshot: yarn.name,
        brandSnapshot: yarn.brand,
        mPer100gSnapshot: yarn.mPer100g,
        compositionSnapshot: yarn.composition,
        colorName: body.colorName ? String(body.colorName) : null,
        dyelot: body.dyelot ? String(body.dyelot) : null,
        totalWeightG,
        currentWeightG: totalWeightG,
        note: body.note ? String(body.note) : null,
        images,
      },
      select: SKEIN_SELECT,
    });
    res.status(201).json(skein);
  } catch (error) {
    console.error("[Stash] createSkein failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /stash/skeins/:id — карточка (включая swatches, usages). Подбор
 * описаний (matches) — отдельный роут GET /stash/skeins/:id/matches (T14),
 * не встроен сюда: тот единственный, кому нужен live join с Yarn, а не
 * снимок (план §5.12).
 */
export const getSkein = async (req: Request, res: Response): Promise<void> => {
  // loadOwnedSkein уже проверил владение и положил базовую запись в
  // req.skein — здесь дозагружаем swatches/usages одним запросом.
  const id = req.skein!.id;
  try {
    const [skein, pendingSuggestion] = await Promise.all([
      prisma.stashSkein.findUnique({
        where: { id },
        select: {
          ...SKEIN_SELECT,
          swatches: {
            orderBy: { createdAt: "asc" },
          },
          usages: {
            orderBy: { createdAt: "desc" },
          },
        },
      }),
      // Не даём подать вторую заявку на тот же артикул, пока первая ещё не
      // рассмотрена — фронт скрывает форму дозаполнения и показывает "на
      // рассмотрении" (кнопка "Дозаполнить" на карточке пряжи).
      prisma.yarnFieldSuggestion.findFirst({
        where: { yarnId: req.skein!.yarnId, status: "PENDING" },
        select: { id: true, mPer100g: true, composition: true },
      }),
    ]);
    res.json({ ...skein, pendingYarnFieldSuggestion: pendingSuggestion });
  } catch (error) {
    console.error("[Stash] getSkein failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** PATCH /stash/skeins/:id — редактировать (цвет, партия, вес, фото, заметка). */
export const updateSkein = async (req: Request, res: Response): Promise<void> => {
  const id = req.skein!.id;
  const body = req.body ?? {};

  const data: Prisma.StashSkeinUpdateInput = {};
  if ("colorName" in body) data.colorName = body.colorName ? String(body.colorName) : null;
  if ("dyelot" in body) data.dyelot = body.dyelot ? String(body.dyelot) : null;
  if ("note" in body) data.note = body.note ? String(body.note) : null;
  if ("images" in body) {
    const images: string[] = Array.isArray(body.images) ? body.images.map(String) : [];
    if (images.length > MAX_STASH_IMAGES_PER_SKEIN) {
      res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото на моток` });
      return;
    }
    const originsCheck = validateNewStashImageOrigins(images);
    if (!originsCheck.ok) {
      res.status(400).json({ error: originsCheck.error });
      return;
    }
    data.images = images;
  }
  // totalWeightG — редактируемое поле само по себе (например, опечатка при
  // вводе), но currentWeightG НЕ трогается здесь: та меняется только вместе
  // со StashUsage атомарно (см. logUsage/undoUsage), никогда прямым PATCH —
  // иначе инвариант currentWeightG = totalWeightG - Σusages расходится.
  if ("totalWeightG" in body) {
    const totalWeightG = Number(body.totalWeightG);
    if (!Number.isFinite(totalWeightG) || totalWeightG <= 0) {
      res.status(400).json({ error: "totalWeightG must be a positive number" });
      return;
    }
    data.totalWeightG = totalWeightG;
  }

  try {
    const updated = await prisma.stashSkein.update({
      where: { id },
      data,
      select: SKEIN_SELECT,
    });
    res.json(updated);
  } catch (error) {
    console.error("[Stash] updateSkein failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** DELETE /stash/skeins/:id — удалить свою запись. */
export const deleteSkein = async (req: Request, res: Response): Promise<void> => {
  const id = req.skein!.id;
  try {
    // stashSkeinId у YarnFieldSuggestion — не настоящая Prisma-связь (нет FK,
    // намеренно: "заявка переживает удаление скейна", см. комментарий у
    // suggestYarnFields), поэтому без явной очистки здесь PENDING-заявка
    // осиротела бы: её mPer100g/composition уже записаны в snapshot
    // удаляемого мотка и пропадут вместе с ним, а "одна PENDING-заявка на
    // артикул" продолжала бы блокировать дозаполнение этого же артикула
    // другими мотками пользователя (или другими пользователями) навсегда.
    await prisma.$transaction([
      prisma.yarnFieldSuggestion.updateMany({
        where: { stashSkeinId: id, status: "PENDING" },
        data: { status: "REJECTED" },
      }),
      // onDelete: Cascade на StashSwatch/StashUsage.skein — удаляет их вместе.
      prisma.stashSkein.delete({ where: { id } }),
    ]);
    res.json({ ok: true });
  } catch (error) {
    console.error("[Stash] deleteSkein failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Образцы (StashSwatch) ───────────────────────────────────────────────

/** POST /stash/skeins/:id/swatches — добавить образец. */
export const createSwatch = async (req: Request, res: Response): Promise<void> => {
  const skeinId = req.skein!.id;
  const body = req.body ?? {};

  const toDecimal = (v: unknown): number | null =>
    v == null || v === "" ? null : Number(v);
  const toInt = (v: unknown): number | null =>
    v == null || v === "" ? null : Math.trunc(Number(v));

  const images: string[] = Array.isArray(body.images) ? body.images.map(String) : [];
  if (images.length > MAX_STASH_IMAGES_PER_SWATCH) {
    res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SWATCH} фото на образец` });
    return;
  }
  const originsCheck = validateNewStashImageOrigins(images);
  if (!originsCheck.ok) {
    res.status(400).json({ error: originsCheck.error });
    return;
  }

  try {
    const swatch = await prisma.stashSwatch.create({
      data: {
        skeinId,
        images,
        needleSizeRaw: body.needleSizeRaw ? String(body.needleSizeRaw) : null,
        strandsCount: toInt(body.strandsCount),
        densityStitchesBefore: toDecimal(body.densityStitchesBefore),
        densityRowsBefore: toDecimal(body.densityRowsBefore),
        densityStitchesAfter: toDecimal(body.densityStitchesAfter),
        densityRowsAfter: toDecimal(body.densityRowsAfter),
      },
    });
    res.status(201).json(swatch);
  } catch (error) {
    console.error("[Stash] createSwatch failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** PATCH /stash/swatches/:id — редактировать образец. */
export const updateSwatch = async (req: Request, res: Response): Promise<void> => {
  const id = req.swatch!.id;
  const body = req.body ?? {};

  const toDecimal = (v: unknown): number | null | undefined =>
    v === undefined ? undefined : v == null || v === "" ? null : Number(v);
  const toInt = (v: unknown): number | null | undefined =>
    v === undefined ? undefined : v == null || v === "" ? null : Math.trunc(Number(v));

  const data: Prisma.StashSwatchUpdateInput = {};
  if ("images" in body) {
    const images: string[] = Array.isArray(body.images) ? body.images.map(String) : [];
    if (images.length > MAX_STASH_IMAGES_PER_SWATCH) {
      res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SWATCH} фото на образец` });
      return;
    }
    const originsCheck = validateNewStashImageOrigins(images);
    if (!originsCheck.ok) {
      res.status(400).json({ error: originsCheck.error });
      return;
    }
    data.images = images;
  }
  if ("needleSizeRaw" in body) data.needleSizeRaw = body.needleSizeRaw ? String(body.needleSizeRaw) : null;
  const sc = toInt(body.strandsCount);
  if (sc !== undefined) data.strandsCount = sc;
  const dsb = toDecimal(body.densityStitchesBefore);
  if (dsb !== undefined) data.densityStitchesBefore = dsb;
  const drb = toDecimal(body.densityRowsBefore);
  if (drb !== undefined) data.densityRowsBefore = drb;
  const dsa = toDecimal(body.densityStitchesAfter);
  if (dsa !== undefined) data.densityStitchesAfter = dsa;
  const dra = toDecimal(body.densityRowsAfter);
  if (dra !== undefined) data.densityRowsAfter = dra;

  try {
    const updated = await prisma.stashSwatch.update({ where: { id }, data });
    res.json(updated);
  } catch (error) {
    console.error("[Stash] updateSwatch failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** DELETE /stash/swatches/:id — удалить образец. */
export const deleteSwatch = async (req: Request, res: Response): Promise<void> => {
  const id = req.swatch!.id;
  try {
    await prisma.stashSwatch.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error("[Stash] deleteSwatch failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Расход запаса (StashUsage) ──────────────────────────────────────────

/**
 * POST /stash/skeins/:id/usage — списать расход (план §2/§6, cross-model
 * finding #3/#4). Вставка StashUsage и декремент currentWeightG — ОДНА
 * атомарная операция в одной транзакции: raw UPDATE с WHERE-guard
 * (currentWeightG >= amount), а не "прочитать баланс, потом два отдельных
 * запроса" — иначе параллельное списание с двух вкладок может увести
 * остаток в минус (race condition). 0 затронутых строк UPDATE ⇒ откат
 * транзакции ⇒ 400, а не тихий недосписанный остаток.
 */
export const logUsage = async (req: Request, res: Response): Promise<void> => {
  const skeinId = req.skein!.id;
  const userId = req.user!.userId;
  const body = req.body ?? {};

  const amountG = Number(body.amountG);
  if (!Number.isFinite(amountG) || amountG <= 0) {
    res.status(400).json({ error: "amountG must be a positive number" });
    return;
  }

  // Привязка к готовому описанию из каталога (patternId) — платная фича,
  // как и getMatches (Figma node-id=1360:21904): без подписки поле "Описание"
  // задизейблено на фронте, но проверяем и здесь — тело запроса нельзя
  // доверять клиенту молча. Ручной ввод автора/названия (без привязки к
  // каталогу) бесплатен всем — доступен через "Добавить вручную" на шаге 2.
  const unlimited = await hasUnlimitedStashAccess(userId);
  const patternId = unlimited && typeof body.patternId === "string" ? body.patternId : null;
  const projectTitle = body.projectTitle ? String(body.projectTitle) : null;
  const needleSizeRaw = body.needleSizeRaw ? String(body.needleSizeRaw) : null;
  // Ручной ввод — описания нет в каталоге (шаг 2, Figma node-id=1360:24052,
  // "Добавить вручную"). Пишутся напрямую в snapshot-поля, patternId
  // остаётся null — та же семантика, что у случая "Pattern удалён из
  // каталога, снимок остался", просто без предшествующей живой связи.
  // Игнорируются, если patternId указан (тот путь снимает title/author
  // из реального Pattern, а не из тела запроса).
  const manualAuthorName = typeof body.manualAuthorName === "string" ? body.manualAuthorName.trim() : "";
  const manualDescriptionTitle = typeof body.manualDescriptionTitle === "string" ? body.manualDescriptionTitle.trim() : "";
  const finishedPhotos: string[] = Array.isArray(body.finishedPhotos) ? body.finishedPhotos.map(String) : [];
  if (finishedPhotos.length > MAX_STASH_IMAGES_PER_SKEIN) {
    res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото готового изделия` });
    return;
  }
  if (finishedPhotos.length > 0) {
    const originsCheck = validateNewStashImageOrigins(finishedPhotos);
    if (!originsCheck.ok) {
      res.status(400).json({ error: originsCheck.error });
      return;
    }
  }

  try {
    let patternSnapshot: { title: string; authorName: string } | null = null;
    if (patternId) {
      const pattern = await prisma.pattern.findUnique({
        where: { id: patternId },
        select: { title: true, author: { select: { name: true } } },
      });
      if (!pattern) {
        res.status(404).json({ error: "Pattern not found" });
        return;
      }
      patternSnapshot = { title: pattern.title, authorName: pattern.author.name };
    }

    const usage = await prisma.$transaction(async (tx) => {
      // Raw SQL — Prisma's high-level update() has no way to express
      // "UPDATE ... WHERE currentWeightG >= $amount" as a single atomic
      // statement; $executeRaw gives the row count directly.
      const affected = await tx.$executeRaw`
        UPDATE "StashSkein"
        SET "currentWeightG" = "currentWeightG" - ${amountG}, "updatedAt" = now()
        WHERE id = ${skeinId} AND "currentWeightG" >= ${amountG}
      `;
      if (affected === 0) {
        // Различаем "скейна нет" (не должно случиться — loadOwnedSkein уже
        // проверил) от "запроса недостаточно" для внятного текста ошибки.
        const current = await tx.stashSkein.findUnique({
          where: { id: skeinId },
          select: { currentWeightG: true },
        });
        throw new InsufficientStashError(current?.currentWeightG ?? 0);
      }

      const patternTitleSnapshot = patternSnapshot?.title ?? (manualDescriptionTitle || null);
      return tx.stashUsage.create({
        data: {
          skeinId,
          amountG,
          needleSizeRaw,
          // Название проекта (шаг 2) необязательно — если пользователь его не
          // ввёл, но выбрал/вписал описание, карточка показывает название
          // описания вместо "Без названия" (fallback только здесь: сам
          // patternTitleSnapshot ниже остаётся источником правды для поля
          // "Описание" в карточке, не подменяется).
          projectTitle: projectTitle ?? patternTitleSnapshot,
          patternId,
          patternTitleSnapshot,
          patternAuthorSnapshot: patternSnapshot?.authorName ?? (manualAuthorName || null),
          finishedPhotos,
          note: body.note ? String(body.note) : null,
        },
      });
    });

    res.status(201).json(usage);
  } catch (error) {
    if (error instanceof InsufficientStashError) {
      res.status(400).json({
        error: `Недостаточно пряжи: осталось ${error.currentWeightG} г`,
        currentWeightG: error.currentWeightG,
      });
      return;
    }
    console.error("[Stash] logUsage failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PATCH /stash/usage/:id — редактирование уже списанного проекта. Вес
 * (amountG) сознательно НЕ редактируется здесь — он завязан на
 * StashSkein.currentWeightG (см. logUsage/undoUsage), менять его
 * потребовало бы того же atomic-guard пересчёта остатка; если нужно
 * исправить количество, пользователь отменяет списание (undoUsage) и
 * списывает заново. Здесь — только описательные поля.
 */
export const updateUsage = async (req: Request, res: Response): Promise<void> => {
  const usage = req.usage!;
  const userId = req.user!.userId;
  const body = req.body ?? {};

  const data: Prisma.StashUsageUpdateInput = {};
  if ("needleSizeRaw" in body) data.needleSizeRaw = body.needleSizeRaw ? String(body.needleSizeRaw) : null;
  if ("projectTitle" in body) data.projectTitle = body.projectTitle ? String(body.projectTitle) : null;
  if ("note" in body) data.note = body.note ? String(body.note) : null;

  if ("finishedPhotos" in body) {
    const finishedPhotos: string[] = Array.isArray(body.finishedPhotos) ? body.finishedPhotos.map(String) : [];
    if (finishedPhotos.length > MAX_STASH_IMAGES_PER_SKEIN) {
      res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото готового изделия` });
      return;
    }
    if (finishedPhotos.length > 0) {
      const originsCheck = validateNewStashImageOrigins(finishedPhotos);
      if (!originsCheck.ok) {
        res.status(400).json({ error: originsCheck.error });
        return;
      }
    }
    data.finishedPhotos = finishedPhotos;
  }

  // Смена привязки к описанию (patternId) или ручных автора/названия — та
  // же логика снимка, что в logUsage: patternId побеждает, если указан,
  // ручные поля игнорируются в этом случае. "patternId" со значением null
  // в теле — явный разрыв связи с каталогом (переход на ручной ввод).
  if ("patternId" in body || "manualAuthorName" in body || "manualDescriptionTitle" in body) {
    const unlimited = await hasUnlimitedStashAccess(userId);
    const patternId = unlimited && typeof body.patternId === "string" ? body.patternId : null;

    if (patternId) {
      const pattern = await prisma.pattern.findUnique({
        where: { id: patternId },
        select: { title: true, author: { select: { name: true } } },
      });
      if (!pattern) {
        res.status(404).json({ error: "Pattern not found" });
        return;
      }
      data.pattern = { connect: { id: patternId } };
      data.patternTitleSnapshot = pattern.title;
      data.patternAuthorSnapshot = pattern.author.name;
    } else {
      const manualAuthorName = typeof body.manualAuthorName === "string" ? body.manualAuthorName.trim() : "";
      const manualDescriptionTitle = typeof body.manualDescriptionTitle === "string" ? body.manualDescriptionTitle.trim() : "";
      data.pattern = { disconnect: true };
      data.patternTitleSnapshot = manualDescriptionTitle || null;
      data.patternAuthorSnapshot = manualAuthorName || null;
    }
  }

  try {
    const updated = await prisma.stashUsage.update({ where: { id: usage.id }, data });
    res.json(updated);
  } catch (error) {
    console.error("[Stash] updateUsage failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

class InsufficientStashError extends Error {
  constructor(public currentWeightG: number) {
    super("Insufficient stash");
  }
}

/**
 * DELETE /stash/usage/:id — отменить ошибочное списание. Симметрично
 * logUsage: raw UPDATE с встречным WHERE-guard (currentWeightG + amount <=
 * totalWeightG) в одной транзакции с удалением строки — без этого
 * ограничения двойное срабатывание отмены (или отмена в гонке с новым
 * списанием) может увести остаток выше исходного веса.
 */
export const undoUsage = async (req: Request, res: Response): Promise<void> => {
  const usage = req.usage!;
  const skeinId = usage.skeinId;
  const amountG = usage.amountG;

  try {
    await prisma.$transaction(async (tx) => {
      const affected = await tx.$executeRaw`
        UPDATE "StashSkein"
        SET "currentWeightG" = "currentWeightG" + ${amountG}, "updatedAt" = now()
        WHERE id = ${skeinId} AND "currentWeightG" + ${amountG} <= "totalWeightG"
      `;
      if (affected === 0) {
        throw new UndoWouldExceedTotalError();
      }
      await tx.stashUsage.delete({ where: { id: usage.id } });
    });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof UndoWouldExceedTotalError) {
      // Практически недостижимо при нормальном использовании (это была бы
      // повторная отмена той же usage, а deleteMany выше уже убрал бы
      // строку) — но встречный guard остаётся на случай гонки двух
      // параллельных запросов на отмену одного usageId.
      res.status(409).json({ error: "Эта отмена уже была применена" });
      return;
    }
    console.error("[Stash] undoUsage failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

class UndoWouldExceedTotalError extends Error {}

// ─── Подбор описаний («что можно связать») — T14, план §4 ────────────────

const YARN_RANGE_TOLERANCE = 0.125; // ±12.5% (был ±8% — расширено, см. комментарий у перебора сложений ниже)
// Вязание в несколько сложений (N нитей вместе) — реальный сценарий, не
// учтённый исходной проверкой "толщина ±X% от mPer100g мотка как есть":
// тонкая нить, сложенная вдвое-впятеро, даёт совсем другой ЭФФЕКТИВНЫЙ
// метраж (800м/100г в 3 нити ≈ 267м/100г), и описание с целевой толщиной
// не находилось вообще, даже с расширенным допуском. Складывать в N нитей
// имеет смысл только для исходно ТОНКОЙ нити (500м/100г и выше) — толстую
// пряжу никто не сдваивает, это исказило бы совпадения без надобности.
const MIN_STRAND_MPER100G = 500;
const MAX_STRANDS = 5;

interface MatchItem {
  id: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  authorName: string;
  // Инструмент (спицы/крючок) — показывается в карточке подбора вместе с
  // автором, шаг 2 флоу списания (Figma node-id=1348:10906). Один Pattern
  // может иметь несколько инструментов (Instrument[] many-to-many); строкой,
  // через запятую, тем же способом, что и остальные "показать список одной
  // строкой" места в проекте.
  instruments: string[];
  // Первая категория описания (Pattern.categories — many-to-many на
  // ProductType, первая — как primaryProductType в patternsController.ts) —
  // карточка "Что можно связать" в StashSkeinDetails.tsx показывает
  // название/категорию/инструмент, не название/автора.
  category: string | null;
  matchedBy: ("exact" | "thickness" | "density")[];
  // Заполнено только когда совпадение по толщине нашлось со сложением > 1
  // нити (matchedBy содержит "thickness") — карточка подписывается "При
  // вязании в N сложений". null — совпадение по толщине не было, либо было
  // найдено в 1 нить (обычный случай, подписи не нужно).
  strandsCount: number | null;
  // Уровень совместимости состава (A/B/C), заполнен только когда матч
  // пришёл через "thickness" И у мотка есть структурированный состав —
  // см. compositionMatch.ts. null — состав не участвовал в этом совпадении
  // (либо у мотка/кандидата состав не структурирован, либо совпадение
  // пришло через exact/density, где состав не проверяется отдельно).
  compositionLevel: "A" | "B" | "C" | null;
}

/**
 * GET /stash/skeins/:id/matches — подбор описаний по трём НЕЗАВИСИМЫМ
 * критериям, результаты ОБЪЕДИНЯЮТСЯ (не последовательный fallback, план
 * §4): (1) точный артикул через PatternYarn.yarnId (резолвя mergedIntoId —
 * один hop, тем же способом, что и остальной код сегодня); (2) толщина —
 * Pattern.yarnRanges пересекается с [mPer100g×0.92, mPer100g×1.08], ДОПОЛНИТЕЛЬНО
 * отфильтрованная по составу (compositionMatch.ts — AND внутри этого
 * критерия, не отдельный 4-й критерий: толщина совпала, но состав кандидата
 * даёт X, значит толщина в этот раз не считается совпадением); (3) плотность
 * последнего образца ПОСЛЕ ВТО, допуск ±1 петля/±1 ряд. Состав применяется
 * только когда он структурирован (YarnComposition) хотя бы у мотка
 * пользователя — иначе (сырой текстовый composition, ещё не разобранный)
 * толщина работает как раньше, без фильтра.
 *
 * Единственное место в /stash/*, которому нужен LIVE join с Yarn (не
 * снимок) — подбору нужны актуальные PatternYarn/mPer100g ЦЕЛЕВОГО (после
 * возможного merge) артикула, план §5.12.
 */
export const getMatches = async (req: Request, res: Response): Promise<void> => {
  const skein = req.skein!;
  const userId = req.user!.userId;

  // Подбор описаний — платная фича (обновлённая модель, Figma
  // node-id=1360:21430), но карточки ВСЁ РАВНО считаются и отдаются
  // полностью для пользователей без подписки — макет показывает реальные
  // (размытые фронтом) карточки, не пустую заглушку. isLocked говорит
  // фронту, размывать ли их и показывать замок вместо перехода по клику.
  const isLocked = !(await hasUnlimitedStashAccess(userId));

  try {
    // Резолвим yarnId до актуальной (не слитой) карточки — mergeYarn уже
    // переносит StashSkein.yarnId на targetId (T5), так что в норме это
    // no-op; single-hop resolve оставлен на случай рассинхронизации.
    const yarn = await prisma.yarn.findUnique({
      where: { id: skein.yarnId },
      select: {
        id: true, mergedIntoId: true, mPer100g: true,
        compositions: { select: { percentage: true, fiberType: { select: { baseFiber: true } } } },
      },
    });
    const effectiveYarnId = yarn?.mergedIntoId ?? yarn?.id ?? skein.yarnId;
    const mPer100g = yarn?.mPer100g ?? skein.mPer100gSnapshot;
    // Состав мотка в терминах baseFiber — сравнение заменителей идёт на
    // этом уровне (не по конкретному подтипу с гранями/тонкостью), см.
    // compositionMatch.ts. Пустой массив у карточек без структурированного
    // состава — фильтр по составу тогда не применяется вовсе (см. ниже).
    const originalComposition = (yarn?.compositions ?? []).map((c) => ({
      baseFiber: c.fiberType.baseFiber,
      percentage: c.percentage,
    }));
    const substituteIndex = originalComposition.length > 0 ? await loadSubstituteIndex() : null;

    const matchedIds = new Map<string, Set<"exact" | "thickness" | "density">>();
    const addMatch = (id: string, kind: "exact" | "thickness" | "density") => {
      if (!matchedIds.has(id)) matchedIds.set(id, new Set());
      matchedIds.get(id)!.add(kind);
    };
    // Наименьшее N сложений, при котором нашлось совпадение по толщине, на
    // паттерн — используется на фронте для подписи "При вязании в N
    // сложений". Не трогается для совпадений по exact/density.
    const strandsByPattern = new Map<string, number>();
    // Лучший (наименьший) уровень совместимости состава, найденный для
    // паттерна — один паттерн может быть привязан к нескольким артикулам
    // пряжи с разным составом, берём самый удачный.
    const compositionLevelByPattern = new Map<string, "A" | "B" | "C">();
    const COMPOSITION_LEVEL_RANK = { A: 0, B: 1, C: 2 } as const;

    // (1) Точный артикул.
    const exactMatches = await prisma.patternYarn.findMany({
      where: { yarnId: effectiveYarnId, status: "ACTIVE", pattern: { isVisible: true } },
      select: { patternId: true },
    });
    for (const m of exactMatches) addMatch(m.patternId, "exact");

    // (2) Толщина ±12% — сравнение с РЕАЛЬНЫМ mPer100g конкретных артикулов
    // пряжи, залинкованных на описание через PatternYarn (status: ACTIVE),
    // а не с категориальным диапазоном Pattern.yarnRanges (та метка —
    // ручной выбор автора при создании описания, не факт о толщине
    // конкретного привязанного артикула). Совпадение — если хотя бы один
    // залинкованный артикул попадает в допуск.
    //
    // Перебор N=1..MAX_STRANDS сложений: сложенная вдвое-впятеро нить
    // становится ТОЛЩЕ, то есть эффективный метраж мотка ПАДАЕТ в N раз
    // (800м/100г, сложенная в 3 нити, "работает" как 800/3≈267м/100г).
    // Допуск ±12.5% строится симметрично вокруг ЭТОГО эффективного
    // метража — та же логика, что и раньше для N=1 (mPer100g×1), просто
    // теперь mPer100g/strands вместо голого mPer100g. N>1 применяется
    // только если исходная нить тонкая (mPer100g >= MIN_STRAND_MPER100G) —
    // толстую пряжу не сдваивают. Наименьшее подходящее N сохраняется как
    // самое правдоподобное.
    if (mPer100g != null) {
      const maxStrands = mPer100g >= MIN_STRAND_MPER100G ? MAX_STRANDS : 1;
      for (let strands = 1; strands <= maxStrands; strands++) {
        const effectiveMPer100g = mPer100g / strands;
        const lo = effectiveMPer100g * (1 - YARN_RANGE_TOLERANCE);
        const hi = effectiveMPer100g * (1 + YARN_RANGE_TOLERANCE);
        const thicknessMatches = await prisma.patternYarn.findMany({
          where: {
            status: "ACTIVE",
            pattern: { isVisible: true },
            yarn: { mPer100g: { gte: lo, lte: hi } },
          },
          select: {
            patternId: true,
            // Состав кандидата — лёгкий join (1-3 строки на артикул),
            // грузится всегда; фильтруется по нему только когда у самого
            // мотка есть структурированный состав (substituteIndex != null).
            yarn: { select: { compositions: { select: { percentage: true, fiberType: { select: { baseFiber: true } } } } } },
          },
        });
        for (const m of thicknessMatches) {
          // Состав — доп. фильтр ВНУТРИ критерия толщины (AND), не
          // отдельный независимый критерий: описание проходит только если
          // толщина совпала И (состав неизвестен ИЛИ состав дал уровень A/B/C).
          if (substituteIndex) {
            const candidateComposition = m.yarn.compositions.map((c) => ({
              baseFiber: c.fiberType.baseFiber,
              percentage: c.percentage,
            }));
            if (candidateComposition.length > 0) {
              const result = scoreComposition(originalComposition, candidateComposition, substituteIndex);
              if (result.level === "X") continue;
              const prevLevel = compositionLevelByPattern.get(m.patternId);
              if (!prevLevel || COMPOSITION_LEVEL_RANK[result.level] < COMPOSITION_LEVEL_RANK[prevLevel]) {
                compositionLevelByPattern.set(m.patternId, result.level);
              }
            }
          }
          addMatch(m.patternId, "thickness");
          if (!strandsByPattern.has(m.patternId)) strandsByPattern.set(m.patternId, strands);
        }
      }
    }

    // (3) Плотность последнего образца ПОСЛЕ ВТО, ±1 петля/±1 ряд.
    const lastSwatch = await prisma.stashSwatch.findFirst({
      where: { skeinId: skein.id, densityStitchesAfter: { not: null }, densityRowsAfter: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { densityStitchesAfter: true, densityRowsAfter: true },
    });
    if (lastSwatch?.densityStitchesAfter != null && lastSwatch?.densityRowsAfter != null) {
      const stitches = Number(lastSwatch.densityStitchesAfter);
      const rows = Number(lastSwatch.densityRowsAfter);
      const densityMatches = await prisma.pattern.findMany({
        where: {
          isVisible: true,
          densityStitches: { gte: stitches - 1, lte: stitches + 1 },
          densityRows: { gte: rows - 1, lte: rows + 1 },
        },
        select: { id: true },
      });
      for (const p of densityMatches) addMatch(p.id, "density");
    }

    if (matchedIds.size === 0) {
      res.json({ items: [] satisfies MatchItem[], isLocked });
      return;
    }

    const patterns = await prisma.pattern.findMany({
      where: { id: { in: [...matchedIds.keys()] } },
      select: {
        id: true, title: true, imageUrl: true, thumbnailUrl: true,
        author: { select: { name: true } },
        instruments: { select: { name: true } },
        categories: { select: { name: true } },
      },
    });

    const items: MatchItem[] = patterns.map((p) => {
      const strands = strandsByPattern.get(p.id);
      return {
        id: p.id,
        title: p.title,
        imageUrl: p.imageUrl,
        thumbnailUrl: p.thumbnailUrl || p.imageUrl,
        authorName: p.author.name,
        instruments: p.instruments.map((i) => i.name),
        category: p.categories[0]?.name ?? null,
        matchedBy: [...(matchedIds.get(p.id) ?? [])],
        strandsCount: strands != null && strands > 1 ? strands : null,
        compositionLevel: compositionLevelByPattern.get(p.id) ?? null,
      };
    });

    res.json({ items, isLocked });
  } catch (error) {
    console.error("[Stash] getMatches failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Тонкие обёртки над yarnsController (план §3) ────────────────────────

/**
 * GET /stash/yarns/suggest?q=...&page=1&brand=... — та же логика поиска,
 * что и общий suggestYarns() в yarnsController.ts (только APPROVED), плюс
 * Ravelry API — специфика именно хранилища пряжи, поэтому не переиспользует
 * тот хендлер as-is, как раньше: (а) ВСЕГДА (не только когда своих нет)
 * дополнительно показываем варианты из Ravelry, до 30 штук за страницу
 * (без создания записей — см. searchRavelryPreview,
 * YarnSuggestion.ravelryId без id) — найденное у нас может не подходить
 * пользователю (другой бренд с похожим названием), и скрывать
 * Ravelry-альтернативы только потому, что нашлась хоть одна своя запись,
 * было бы навязчиво; выбор конкретного варианта импортирует его через
 * POST /stash/yarns/import-ravelry; (б) если топовое СВОЁ совпадение пусты
 * metraж/состав, ищем в Ravelry по тому же имени и дозаполняем именно эту
 * запись. Best-effort — сбой похода в Ravelry не должен ломать обычный
 * автокомплит.
 *
 * page — только для Ravelry-части (infinite scroll в подсказках): 1-based,
 * фронт запрашивает page+1 по доскроллу списка до конца, пока
 * hasMoreFromRavelry не станет false. Наш справочник (items) НЕ
 * постранично — take:20 фиксирован, как и раньше, там нет UI для листания.
 *
 * brand — необязательный, значение соседнего поля "Бренд" в форме
 * (если пользователь его уже заполнил вручную до выбора описания) —
 * Ravelry не поддерживает серверную фильтрацию по бренду (проверено
 * напрямую: параметр company/yarn_company в их /yarns/search.json
 * игнорируется), поэтому просто поднимаем совпадения по бренду вверх
 * списка Ravelry-результатов клиентской сортировкой, не теряя остальные.
 */
export const suggestYarns = async (req: Request, res: Response): Promise<void> => {
  const q = String(req.query.q || "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const brandHint = String(req.query.brand || "").trim().toLowerCase();
  if (q.length < 3) {
    res.json({ items: [], hasMoreFromRavelry: false });
    return;
  }
  const key = normalizeYarnKey(q);
  if (!key) {
    res.json({ items: [], hasMoreFromRavelry: false });
    return;
  }

  // Наш справочник запрашивается только на первой странице — Ravelry-
  // пагинация (page>1) листает исключительно Ravelry-часть, наши
  // APPROVED-совпадения уже все показаны на первой странице разом.
  const items = page === 1
    ? await prisma.yarn.findMany({
        where: {
          mergedIntoId: null,
          isActive: true,
          status: YarnStatus.APPROVED,
          OR: [
            { normalizedKey: { contains: key } },
            { aliases: { some: { normalizedAlias: { contains: key } } } },
          ],
        },
        select: {
          id: true, name: true, brand: true, mPer100g: true, composition: true,
          normalizedKey: true, isGeneric: true, photoUrl: true, _count: { select: { patterns: true } },
        },
        orderBy: [{ patterns: { _count: "desc" } }, { name: "asc" }],
        take: 20,
      })
    : [];

  // fromRavelry/ravelryId на КОНКРЕТНОМ элементе — на фронте показывается
  // как подпись "Данные с Ravelry" рядом именно с той подсказкой: (а) для
  // preview-вариантов (ravelryId задан, id ещё нет — запись не создана),
  // (б) когда существующая карточка была дозаполнена прямо сейчас.
  // Остальные элементы списка (наш обычный справочник) подписи не
  // получают.
  const itemsWithSource: Array<
    Partial<typeof items[number]> &
      Pick<typeof items[number], "name" | "brand" | "normalizedKey" | "isGeneric" | "mPer100g" | "composition" | "photoUrl" | "_count"> & {
        fromRavelry: boolean;
        ravelryId?: number;
      }
  > = items.map((item) => ({ ...item, fromRavelry: false }));

  let hasMoreFromRavelry = false;

  try {
    // Дозаполнение топового СВОЕГО совпадения — только если оно у нас есть
    // и в нём пусто. Не блокирует показ Ravelry-альтернатив ниже: это
    // разные операции над разными результатами. Фото сознательно НЕ
    // дозаполняется — Ravelry-фото привязано к чужому цвету/партии, может
    // не соответствовать реальному мотку пользователя.
    if (itemsWithSource.length > 0) {
      const top = itemsWithSource[0];
      if (top.mPer100g == null || top.composition == null) {
        const enrichedExisting = await enrichYarnFromRavelrySearch(
          // Non-null: top === itemsWithSource[0] в этой ветке — всегда наша
          // запись из items (Ravelry-варианты добавляются в массив ПОСЛЕ
          // этого блока), id у них всегда есть.
          { id: top.id!, mPer100g: top.mPer100g, composition: top.composition },
          q
        );
        if (enrichedExisting) {
          // Дозаполнение уже применилось в БД — перечитываем ту же
          // запись, чтобы клиент увидел новые значения без второго
          // round-trip запроса.
          const refreshed = await prisma.yarn.findUnique({
            where: { id: top.id },
            select: { mPer100g: true, composition: true },
          });
          if (refreshed) {
            top.mPer100g = refreshed.mPer100g;
            top.composition = refreshed.composition;
            top.fromRavelry = true;
          }
        }
      }
    }

    // Ravelry-альтернативы — всегда, не только когда своих 0. На page===1
    // исключаем варианты, чей normalizedKey уже есть в нашем списке (то же
    // имя, просто с другого источника) — не дублируем в подсказках то, что
    // пользователь и так уже видит из нашего справочника; на следующих
    // страницах своих items нет (см. выше), фильтровать не от чего.
    const ownKeys = new Set(itemsWithSource.map((i) => i.normalizedKey));
    const { items: preview, hasMore } = await searchRavelryPreview(q, page);
    hasMoreFromRavelry = hasMore;
    let newFromRavelry = preview.filter((p) => !ownKeys.has(normalizeYarnKey(p.name)));

    // Поднимаем совпадения по уже введённому бренду наверх — Ravelry не
    // умеет фильтровать по бренду на своей стороне (см. комментарий над
    // хендлером), поэтому это чисто клиентская пересортировка ОДНОЙ
    // страницы, не глобальная по всем 30+ результатам сразу.
    if (brandHint) {
      newFromRavelry = [...newFromRavelry].sort((a, b) => {
        const aMatch = a.brand?.toLowerCase().includes(brandHint) ? 0 : 1;
        const bMatch = b.brand?.toLowerCase().includes(brandHint) ? 0 : 1;
        return aMatch - bMatch;
      });
    }

    itemsWithSource.push(
      ...newFromRavelry.map((p) => ({
        // id намеренно ОТСУТСТВУЕТ — записи ещё нет в БД, фронт не должен
        // пытаться выбрать это как обычную подсказку без импорта.
        ravelryId: p.ravelryId,
        name: p.name,
        brand: p.brand,
        mPer100g: null,
        composition: null,
        normalizedKey: normalizeYarnKey(p.name),
        isGeneric: false,
        photoUrl: null,
        _count: { patterns: 0 },
        fromRavelry: true,
      }))
    );
  } catch (error) {
    // Ravelry недоступен/ошибся — не роняем автокомплит, пользователь
    // просто не получит фолбэк-данные в этот раз.
    console.error("[Stash] Ravelry fallback failed:", error);
  }

  res.json({ items: itemsWithSource, hasMoreFromRavelry });
};

/**
 * POST /stash/yarns/import-ravelry — шаг 2 Ravelry-фолбэка (см. комментарий
 * над searchRavelryPreview в ravelryYarnFallback.ts): создаёт (или находит
 * уже созданную кем-то раньше) запись в нашем справочнике по конкретному
 * ravelryId, который пользователь ЯВНО выбрал из превью-подсказок. Вызывать
 * до этого явного выбора нельзя — именно преждевременное создание по
 * первому результату поиска и было причиной бага "выбрал не тот вариант,
 * вернуться к остальным нельзя".
 */
export const importRavelryYarnHandler = async (req: Request, res: Response): Promise<void> => {
  const ravelryId = Number(req.body?.ravelryId);
  if (!Number.isFinite(ravelryId)) {
    res.status(400).json({ error: "ravelryId must be a number" });
    return;
  }
  try {
    const yarn = await importRavelryYarn(ravelryId);
    if (!yarn) {
      res.status(502).json({ error: "Не удалось импортировать пряжу из Ravelry" });
      return;
    }
    res.status(201).json(yarn);
  } catch (error) {
    console.error("[Stash] importRavelryYarn failed:", error);
    res.status(502).json({ error: "Не удалось импортировать пряжу из Ravelry" });
  }
};

/**
 * POST /stash/yarns — переиспользует createAuthorYarn() as-is, только под
 * PREMIUM_YARN_STASH-гейтом вместо AUTHOR_CABINET, с createdVia: STASH_USER
 * (план §5.4 — модерационная очередь должна видеть разницу в доверии).
 */
export const createStashYarn = (req: Request, res: Response) =>
  createAuthorYarn(req, res, "STASH_USER");

/**
 * POST /stash/skeins/:id/suggest-yarn-fix — заявка на дозаполнение пустых
 * полей (метраж/состав) справочного артикула, на который ссылается
 * req.skein.yarnId. Отдельная сущность YarnFieldSuggestion, а не новая
 * Yarn-строка со status: PENDING: это не новый артикул, а дельта-правка к
 * уже APPROVED-записи, попавшей в личное хранилище пользователя как есть
 * (см. комментарий над *Snapshot-полями StashSkein наверху файла).
 *
 * Значение видно владельцу СРАЗУ (mPer100gSnapshot/compositionSnapshot
 * этого конкретного StashSkein обновляются в той же транзакции, что и
 * заявка) — параллельно уходит на модерацию для попадания в общий
 * справочник. Если админ отклонит YarnFieldSuggestion, Yarn.mPer100g/
 * composition НЕ трогаются (rejectYarnFieldSuggestion просто помечает
 * status: REJECTED), а снапшот у владельца, уже обновлённый здесь,
 * остаётся как есть — тот же принцип "снапшот как единственный источник
 * для отображения", что и у остальных *Snapshot-полей: справочник и личная
 * карточка расходятся сознательно, а не по багу.
 *
 * Ограничения:
 * - Ничего не предлагаем поверх уже заполненного значения — иначе рядовой
 *   пользователь мог бы тихо "исправить" верно указанный админом метраж.
 * - Одна PENDING-заявка на артикул одновременно (проверено в getSkein для
 *   фронта, здесь — авторитетная проверка на запись).
 */
export const suggestYarnFields = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const skein = req.skein!;
  const body = req.body ?? {};

  const mPer100g = body.mPer100g !== undefined && body.mPer100g !== null && body.mPer100g !== ""
    ? Number(body.mPer100g)
    : null;
  const composition = typeof body.composition === "string" && body.composition.trim()
    ? body.composition.trim()
    : null;

  if (mPer100g === null && composition === null) {
    res.status(400).json({ error: "Укажите хотя бы одно значение" });
    return;
  }
  if (mPer100g !== null && (!Number.isFinite(mPer100g) || mPer100g <= 0)) {
    res.status(400).json({ error: "Метраж должен быть положительным числом" });
    return;
  }

  try {
    const yarn = await prisma.yarn.findUnique({
      where: { id: skein.yarnId },
      select: { mPer100g: true, composition: true },
    });
    if (!yarn) {
      res.status(404).json({ error: "Артикул пряжи не найден" });
      return;
    }

    // Не принимаем предложение по полю, которое уже заполнено — форма на
    // фронте и так скрывает такие поля, это защита на случай гонки (кто-то
    // другой дозаполнил тот же артикул между открытием формы и сабмитом).
    const finalMPer100g = yarn.mPer100g == null ? mPer100g : null;
    const finalComposition = yarn.composition == null ? composition : null;
    if (finalMPer100g === null && finalComposition === null) {
      res.status(409).json({ error: "Эти поля уже заполнены в справочнике" });
      return;
    }

    const existing = await prisma.yarnFieldSuggestion.findFirst({
      where: { yarnId: skein.yarnId, status: "PENDING" },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({ error: "Заявка по этому артикулу уже на рассмотрении" });
      return;
    }

    const skeinSnapshotUpdate: Prisma.StashSkeinUpdateInput = {};
    if (finalMPer100g !== null) skeinSnapshotUpdate.mPer100gSnapshot = finalMPer100g;
    if (finalComposition !== null) skeinSnapshotUpdate.compositionSnapshot = finalComposition;

    const [suggestion] = await prisma.$transaction([
      prisma.yarnFieldSuggestion.create({
        data: {
          yarnId: skein.yarnId,
          suggestedById: userId,
          stashSkeinId: skein.id,
          mPer100g: finalMPer100g,
          composition: finalComposition,
        },
      }),
      prisma.stashSkein.update({ where: { id: skein.id }, data: skeinSnapshotUpdate }),
    ]);
    res.status(201).json(suggestion);
  } catch (error) {
    console.error("[Stash] suggestYarnFields failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
