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
import { suggestYarns as suggestYarnsHandler, createAuthorYarn } from "./yarnsController";
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
    // onDelete: Cascade на StashSwatch/StashUsage.skein — удаляет их вместе.
    await prisma.stashSkein.delete({ where: { id } });
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

      return tx.stashUsage.create({
        data: {
          skeinId,
          amountG,
          needleSizeRaw,
          projectTitle,
          patternId,
          patternTitleSnapshot: patternSnapshot?.title ?? (manualDescriptionTitle || null),
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

const YARN_RANGE_TOLERANCE = 0.08; // ±8%

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
  matchedBy: ("exact" | "thickness" | "density")[];
}

/**
 * GET /stash/skeins/:id/matches — подбор описаний по трём НЕЗАВИСИМЫМ
 * критериям, результаты ОБЪЕДИНЯЮТСЯ (не последовательный fallback, план
 * §4): (1) точный артикул через PatternYarn.yarnId (резолвя mergedIntoId —
 * один hop, тем же способом, что и остальной код сегодня); (2) толщина —
 * Pattern.yarnRanges пересекается с [mPer100g×0.92, mPer100g×1.08]; (3)
 * плотность последнего образца ПОСЛЕ ВТО, допуск ±1 петля/±1 ряд. Состав
 * сознательно не участвует (план §4 — ненадёжное текстовое сравнение без
 * словаря синонимов).
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
      select: { id: true, mergedIntoId: true, mPer100g: true },
    });
    const effectiveYarnId = yarn?.mergedIntoId ?? yarn?.id ?? skein.yarnId;
    const mPer100g = yarn?.mPer100g ?? skein.mPer100gSnapshot;

    const matchedIds = new Map<string, Set<"exact" | "thickness" | "density">>();
    const addMatch = (id: string, kind: "exact" | "thickness" | "density") => {
      if (!matchedIds.has(id)) matchedIds.set(id, new Set());
      matchedIds.get(id)!.add(kind);
    };

    // (1) Точный артикул.
    const exactMatches = await prisma.patternYarn.findMany({
      where: { yarnId: effectiveYarnId, status: "ACTIVE", pattern: { isVisible: true } },
      select: { patternId: true },
    });
    for (const m of exactMatches) addMatch(m.patternId, "exact");

    // (2) Толщина ±8% — сравнение с РЕАЛЬНЫМ mPer100g конкретных артикулов
    // пряжи, залинкованных на описание через PatternYarn (status: ACTIVE),
    // а не с категориальным диапазоном Pattern.yarnRanges (та метка —
    // ручной выбор автора при создании описания, не факт о толщине
    // конкретного привязанного артикула). Совпадение — если хотя бы один
    // залинкованный артикул попадает в допуск.
    if (mPer100g != null) {
      const lo = mPer100g * (1 - YARN_RANGE_TOLERANCE);
      const hi = mPer100g * (1 + YARN_RANGE_TOLERANCE);
      const thicknessMatches = await prisma.patternYarn.findMany({
        where: {
          status: "ACTIVE",
          pattern: { isVisible: true },
          yarn: { mPer100g: { gte: lo, lte: hi } },
        },
        select: { patternId: true },
      });
      for (const m of thicknessMatches) addMatch(m.patternId, "thickness");
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
      },
    });

    const items: MatchItem[] = patterns.map((p) => ({
      id: p.id,
      title: p.title,
      imageUrl: p.imageUrl,
      thumbnailUrl: p.thumbnailUrl || p.imageUrl,
      authorName: p.author.name,
      instruments: p.instruments.map((i) => i.name),
      matchedBy: [...(matchedIds.get(p.id) ?? [])],
    }));

    res.json({ items, isLocked });
  } catch (error) {
    console.error("[Stash] getMatches failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Тонкие обёртки над yarnsController (план §3) ────────────────────────

/**
 * GET /stash/yarns/suggest — переиспользует suggestYarns() as-is, только
 * APPROVED (тот уже фильтрует так сам).
 */
export const suggestYarns = suggestYarnsHandler;

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

    const suggestion = await prisma.yarnFieldSuggestion.create({
      data: {
        yarnId: skein.yarnId,
        suggestedById: userId,
        stashSkeinId: skein.id,
        mPer100g: finalMPer100g,
        composition: finalComposition,
      },
    });
    res.status(201).json(suggestion);
  } catch (error) {
    console.error("[Stash] suggestYarnFields failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
