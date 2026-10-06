/**
 * Вязальные проекты пользователя (PROJECTS_PLAN.md). Гейтится
 * PREMIUM_YARN_STASH (тот же флаг, что у хранилища пряжи, не отдельная
 * премиум-модель, см. §2.0) на уровне точечных проверок лимита ниже, и
 * requireAdmin на уровне роутера на период тестирования (routes/projects.ts,
 * симметрично routes/stash.ts).
 */
import { Request, Response } from "express";
import { Prisma, ProjectStatus } from "@prisma/client";
import { prisma } from "../prismaClient";
import { hasUnlimitedStashAccess } from "../utils/stashAccess";
import {
  MAX_STASH_IMAGES_PER_SKEIN,
  MAX_STASH_IMAGES_PER_SWATCH,
  validateNewStashImageOrigins,
} from "../utils/stashImages";
import path from "path";
import fs from "fs";
import { MAX_PROJECT_DOCUMENTS, PROJECT_DOCUMENTS_DIR, hasPdfSignature } from "../utils/projectDocuments";

// Бесплатный лимит проектов на пользователя (§2.0) — тот же
// PREMIUM_YARN_STASH, что снимает лимит мотков в хранилище, снимает и
// этот. Считает ВСЕ проекты, включая любой статус.
export const FREE_PROJECT_LIMIT = 5;

const PAGE_SIZE = 20;

// instruments: [{ instrumentId, sizeMm? }] — размер (мм, число с дробной
// частью, напр. 2.25) хранится отдельно на каждой паре (проект,
// инструмент), не на справочнике Instrument (см. ProjectInstrument в
// схеме) — та же вязальщица использует спицы 2,75мм на одном проекте и
// 4мм на другом. Плоский instrumentIds (без размера) больше не
// принимается ни в createProject, ни в updateProject.
interface ProjectInstrumentInput {
  instrumentId: string;
  sizeMm: number | null;
}

function parseInstrumentsInput(raw: unknown): ProjectInstrumentInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i: unknown): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map((i: Record<string, unknown>) => ({
      instrumentId: String(i.instrumentId ?? ""),
      sizeMm: i.sizeMm === undefined || i.sizeMm === null || i.sizeMm === "" ? null : Number(i.sizeMm),
    }))
    .filter((i) => i.instrumentId);
}

class InsufficientStashError extends Error {
  constructor(public currentWeightG: number) {
    super("Insufficient stash");
  }
}

// ─── Список и карточка (§2.1) ────────────────────────────────────────────

const PROJECT_LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  startedAt: true,
  completedAt: true,
  images: true,
  finishedPhotos: true,
  // Подпись карточки в списке ("название + инструмент и размер
  // инструмента") — instrument.name + собственный sizeMm ProjectInstrument
  // (не образца — у образца своя плотность/спицы, см. ProjectSwatch), берём
  // только первую пару как представительную, не список всех.
  instruments: {
    select: { sizeMm: true, instrument: { select: { name: true } } },
    orderBy: { createdAt: "asc" as const },
    take: 1,
  },
} satisfies Prisma.ProjectSelect;

function projectCover(project: { images: string[]; finishedPhotos: string[] }): string | null {
  // Обложка — простое поле на самом Project, без JOIN (см. §5.3: расход
  // на "живой JOIN"/снимок отменён, фото готового изделия хранятся один
  // раз на Project.finishedPhotos, не по нескольким StashUsage).
  return project.finishedPhotos[0] ?? project.images[0] ?? null;
}

/** GET /projects — список проектов пользователя, с фильтром по статусу и поиском по title. */
export const listProjects = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const page = Math.max(1, Number(req.query.page) || 1);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const where: Prisma.ProjectWhereInput = {
    userId,
    ...(status && status in ProjectStatus ? { status: status as ProjectStatus } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
  };

  try {
    const [items, total, totalProjectCount] = await Promise.all([
      prisma.project.findMany({
        where,
        select: PROJECT_LIST_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.project.count({ where }),
      prisma.project.count({ where: { userId } }),
    ]);

    res.json({
      items: items.map(({ instruments, ...p }) => ({
        ...p,
        coverUrl: projectCover(p),
        instrumentNames: instruments.map((i) => i.instrument.name),
        needleSizeRaw: instruments[0]?.sizeMm != null ? String(instruments[0].sizeMm) : null,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalProjectCount,
    });
  } catch (error) {
    console.error(`[Projects] listProjects failed userId=${userId}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const PROJECT_DETAIL_INCLUDE = {
  // pattern (не snapshot-поля) — только для карточки-превью "Описание"
  // (Figma node-id=1476:27969): фото и инструменты живого каталожного
  // паттерна, которых нет в снимках ProjectPattern.patternTitleSnapshot/
  // patternAuthorSnapshot. Nullable — patternId может быть null (паттерн
  // удалён из каталога, см. onDelete: SetNull на ProjectPattern.pattern),
  // тогда фронт показывает карточку без фото/инструмента, только снимки.
  patterns: {
    include: {
      pattern: {
        select: {
          imageUrl: true,
          thumbnailUrl: true,
          instruments: { select: { name: true } },
        },
      },
    },
  },
  yarns: { include: { skein: true } },
  swatches: { orderBy: { createdAt: "asc" as const } },
  instruments: { include: { instrument: true }, orderBy: { createdAt: "asc" as const } },
  // storedFileName — путь на диске, не нужен фронту: файл раздаётся по
  // documentId через отдельный авторизованный эндпоинт (§8.1), не по
  // имени.
  documents: {
    select: { id: true, projectId: true, originalFileName: true, fileSizeBytes: true, createdAt: true },
    orderBy: { createdAt: "asc" as const },
  },
  usages: { orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.ProjectInclude;

/** GET /projects/:id — карточка проекта, все связанные сущности одним запросом. */
export const getProject = async (req: Request, res: Response): Promise<void> => {
  const id = req.project!.id;
  try {
    const project = await prisma.project.findUnique({
      where: { id },
      include: PROJECT_DETAIL_INCLUDE,
    });
    res.json(project);
  } catch (error) {
    console.error(`[Projects] getProject failed projectId=${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Создание (§2.2) ─────────────────────────────────────────────────────

function validateImagesField(images: unknown, limit: number, label: string): string[] | null {
  const arr: string[] = Array.isArray(images) ? images.map(String) : [];
  if (arr.length > limit) return null;
  return arr;
}

interface YarnUsageInput {
  skeinId: string;
  amountG?: number;
}

/**
 * POST /projects — создание. Если status === "COMPLETED" в теле —
 * дополнительно принимает yarnUsages (список привязанной пряжи ДЛЯ ЭТОГО
 * случая, вместо skeinIds — см. §2.2, устранение неоднозначности при
 * eng-review) и finishedPhotos.
 */
export const createProject = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const body = req.body ?? {};

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  const status: ProjectStatus =
    typeof body.status === "string" && body.status in ProjectStatus
      ? (body.status as ProjectStatus)
      : ProjectStatus.IN_PROGRESS;

  const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
  if (Number.isNaN(startedAt.getTime())) {
    res.status(400).json({ error: "Invalid startedAt" });
    return;
  }

  const unlimited = await hasUnlimitedStashAccess(userId);
  if (!unlimited) {
    const existingCount = await prisma.project.count({ where: { userId } });
    if (existingCount >= FREE_PROJECT_LIMIT) {
      res.status(403).json({
        error: `Бесплатный лимит ${FREE_PROJECT_LIMIT} проектов исчерпан`,
        code: "PROJECT_LIMIT_REACHED",
        limit: FREE_PROJECT_LIMIT,
      });
      return;
    }
  }

  const images = validateImagesField(body.images, MAX_STASH_IMAGES_PER_SKEIN, "фото проекта");
  if (images === null) {
    res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото изделия/этапа` });
    return;
  }
  const referencePhotos = validateImagesField(body.referencePhotos, MAX_STASH_IMAGES_PER_SKEIN, "референс");
  if (referencePhotos === null) {
    res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото референса` });
    return;
  }
  // Ссылки (видео-инструкции и т.п.) — тот же validateImagesField (просто
  // "массив строк не длиннее лимита", несмотря на название), не URL-файлы
  // и не проходят проверку происхождения ниже.
  const links = validateImagesField(body.links, MAX_STASH_IMAGES_PER_SKEIN, "ссылка");
  if (links === null) {
    res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} ссылок` });
    return;
  }
  for (const arr of [images, referencePhotos]) {
    const check = validateNewStashImageOrigins(arr);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
  }

  // Фото изделия принимаются при любом статусе, не только COMPLETED —
  // проект "В процессе"/"На паузе" тоже может иметь промежуточные фото
  // результата (пользователь заполняет блок "Фото изделия" в форме
  // независимо от статуса), которые должны сразу попасть в галерею, а не
  // молча теряться.
  const finishedPhotosParsed = validateImagesField(body.finishedPhotos, MAX_STASH_IMAGES_PER_SKEIN, "фото готовой работы");
  if (finishedPhotosParsed === null) {
    res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото готовой работы` });
    return;
  }
  const finishedPhotosCheck = validateNewStashImageOrigins(finishedPhotosParsed);
  if (!finishedPhotosCheck.ok) {
    res.status(400).json({ error: finishedPhotosCheck.error });
    return;
  }
  const finishedPhotos = finishedPhotosParsed;

  // Описание: либо patternIds (привязка к каталогу, 0..N), либо
  // manualAuthor/manualDescription (ручной ввод) — оба сразу не имеют
  // смысла, но не запрещаем явно: пустой patternIds + заполненные manual
  // поля — обычный случай "не нашлось в каталоге".
  const patternIds: string[] = Array.isArray(body.patternIds) ? body.patternIds.map(String) : [];
  const manualAuthor = typeof body.manualAuthor === "string" ? body.manualAuthor.trim() || null : null;
  const manualDescription = typeof body.manualDescription === "string" ? body.manualDescription.trim() || null : null;

  const instrumentsInput = parseInstrumentsInput(body.instruments);

  // Список привязанной пряжи — ОДНО поле, форма зависит от status (§2.2,
  // устранение неоднозначности): status !== COMPLETED -> skeinIds,
  // status === COMPLETED -> yarnUsages (skeinIds в теле игнорируется).
  let skeinIds: string[];
  let yarnUsages: YarnUsageInput[] = [];
  if (status === ProjectStatus.COMPLETED) {
    yarnUsages = Array.isArray(body.yarnUsages)
      ? body.yarnUsages
          .filter((u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null)
          .map((u: Record<string, unknown>) => ({
            skeinId: String(u.skeinId),
            amountG:
              u.amountG === undefined || u.amountG === null || u.amountG === ""
                ? undefined
                : Number(u.amountG),
          }))
      : [];
    skeinIds = yarnUsages.map((u) => u.skeinId);
  } else {
    skeinIds = Array.isArray(body.skeinIds) ? body.skeinIds.map(String) : [];
  }

  interface SwatchInput {
    images?: unknown;
    needleSizeRaw?: unknown;
    instrumentType?: unknown;
    strandsCount?: unknown;
    densityStitchesBefore?: unknown;
    densityRowsBefore?: unknown;
    densityStitchesAfter?: unknown;
    densityRowsAfter?: unknown;
    note?: unknown;
  }
  const swatchesInput: SwatchInput[] = Array.isArray(body.swatches) ? body.swatches : [];

  const toDecimal = (v: unknown): number | null =>
    v == null || v === "" ? null : Number(v);
  const toInt = (v: unknown): number | null =>
    v == null || v === "" ? null : Math.trunc(Number(v));

  try {
    // Снимки паттернов/мотков читаются ДО транзакции — не изменяют
    // состояние, можно параллельно.
    const [patterns, skeins] = await Promise.all([
      patternIds.length
        ? prisma.pattern.findMany({
            where: { id: { in: patternIds } },
            select: { id: true, title: true, author: { select: { name: true } }, instruments: { select: { id: true } } },
          })
        : Promise.resolve([]),
      skeinIds.length
        ? prisma.stashSkein.findMany({
            where: { id: { in: skeinIds }, userId },
            select: { id: true, yarnNameSnapshot: true, brandSnapshot: true },
          })
        : Promise.resolve([]),
    ]);

    if (patternIds.length && patterns.length !== patternIds.length) {
      res.status(404).json({ error: "One or more patterns not found" });
      return;
    }
    if (skeinIds.length && skeins.length !== skeinIds.length) {
      res.status(404).json({ error: "One or more skeins not found or not owned" });
      return;
    }

    // Предзаполнение инструментов из первого паттерна, если инструменты в
    // теле не переданы явно (§4.3 п.4 — "предзаполняем, но всегда даём
    // изменить": на backend это просто означает "если фронт не прислал
    // instruments, взять из паттерна", сам факт "не перезаписывать ручную
    // правку" — ответственность фронта, не хранится на сервере). Размер
    // при предзаполнении из паттерна не заполняется — паттерн не знает
    // конкретный инструмент пользователя.
    const effectiveInstruments: ProjectInstrumentInput[] = instrumentsInput.length
      ? instrumentsInput
      : (patterns[0]?.instruments ?? []).map((i) => ({ instrumentId: i.id, sizeMm: null }));

    const skeinById = new Map(skeins.map((s) => [s.id, s]));

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          userId,
          title,
          status,
          manualAuthor: patternIds.length ? null : manualAuthor,
          manualDescription: patternIds.length ? null : manualDescription,
          startedAt,
          completedAt: status === ProjectStatus.COMPLETED ? new Date() : null,
          note: body.note ? String(body.note) : null,
          images,
          referencePhotos,
          finishedPhotos,
          links,
          instruments: effectiveInstruments.length
            ? { create: effectiveInstruments.map((i) => ({ instrumentId: i.instrumentId, sizeMm: i.sizeMm })) }
            : undefined,
          patterns: patterns.length
            ? {
                create: patterns.map((p) => ({
                  patternId: p.id,
                  patternTitleSnapshot: p.title,
                  patternAuthorSnapshot: p.author.name,
                })),
              }
            : undefined,
          swatches: swatchesInput.length
            ? {
                create: swatchesInput.map((s) => ({
                  images: Array.isArray(s.images) ? s.images.map(String) : [],
                  needleSizeRaw: s.needleSizeRaw ? String(s.needleSizeRaw) : null,
                  instrumentType: s.instrumentType === 'hook' || s.instrumentType === 'needle' ? s.instrumentType : null,
                  strandsCount: toInt(s.strandsCount),
                  densityStitchesBefore: toDecimal(s.densityStitchesBefore),
                  densityRowsBefore: toDecimal(s.densityRowsBefore),
                  densityStitchesAfter: toDecimal(s.densityStitchesAfter),
                  densityRowsAfter: toDecimal(s.densityRowsAfter),
                  note: s.note ? String(s.note) : null,
                })),
              }
            : undefined,
          yarns: skeinIds.length
            ? {
                create: skeinIds.map((skeinId) => {
                  const skein = skeinById.get(skeinId)!;
                  return {
                    skeinId,
                    yarnNameSnapshot: skein.yarnNameSnapshot,
                    brandSnapshot: skein.brandSnapshot,
                  };
                }),
              }
            : undefined,
        },
      });

      // Механика "задним числом завершённого проекта" (§0.3 п.2/§2.2) —
      // только когда status === COMPLETED и указан расход по мотку.
      // currentWeightG НЕ меняется вообще (не +amountG и не -amountG —
      // они взаимоуничтожаются: расход уже был потрачен ДО заведения
      // мотка в приложение, поэтому единственное реальное изменение —
      // totalWeightG растёт, отражая больший объём, чем был изначально
      // введён). Найдено вручную при первом прогоне: более ранняя версия
      // этого кода делала totalWeightG += amountG ЗАТЕМ отдельный
      // currentWeightG -= amountG с guard'ом currentWeightG >= amountG —
      // такой guard справедливо отклонял операцию на уже почти
      // исчерпанном мотке (currentWeightG=20, amountG=320: 20<320), хотя
      // логически операция обязана была пройти всегда (currentWeightG в
      // итоге не меняется). Единственный корректный SQL — вообще не
      // трогать currentWeightG.
      for (const u of yarnUsages) {
        if (u.amountG == null) continue; // amountG опционален для любого мотка
        const amountG = u.amountG;

        await tx.$executeRaw`
          UPDATE "StashSkein"
          SET "totalWeightG" = "totalWeightG" + ${amountG}, "updatedAt" = now()
          WHERE id = ${u.skeinId}
        `;

        const firstPattern = patterns[0];
        await tx.stashUsage.create({
          data: {
            skeinId: u.skeinId,
            amountG,
            projectId: created.id,
            isBackdatedCompletion: true,
            projectTitle: title,
            patternTitleSnapshot: firstPattern?.title ?? manualDescription,
            patternAuthorSnapshot: firstPattern?.author.name ?? manualAuthor,
          },
        });

        await tx.projectYarn.update({
          where: { projectId_skeinId: { projectId: created.id, skeinId: u.skeinId } },
          data: { amountAtCompletionG: amountG },
        });

        console.log(
          `[Projects] createProject backdatedYarn userId=${userId} projectId=${created.id} skeinId=${u.skeinId} amountG=${amountG}`
        );
      }

      return created;
    });

    console.log(`[Projects] createProject ok userId=${userId} projectId=${project.id} status=${status}`);
    const full = await prisma.project.findUnique({ where: { id: project.id }, include: PROJECT_DETAIL_INCLUDE });
    res.status(201).json(full);
  } catch (error) {
    if (error instanceof InsufficientStashError) {
      console.warn(`[Projects] createProject insufficient userId=${userId} currentWeightG=${error.currentWeightG}`);
      res.status(400).json({
        error: `Недостаточно пряжи: осталось ${error.currentWeightG} г`,
        currentWeightG: error.currentWeightG,
      });
      return;
    }
    console.error(`[Projects] createProject failed userId=${userId}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Редактирование (§2.1/§2.3) ──────────────────────────────────────────

/**
 * PATCH /projects/:id — правка полей БЕЗ смены статуса на COMPLETED (тот
 * переход — только через completeProject/createProject, §2.3).
 */
export const updateProject = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const userId = req.user!.userId;
  const body = req.body ?? {};

  if (typeof body.status === "string" && body.status === ProjectStatus.COMPLETED && project.status !== ProjectStatus.COMPLETED) {
    res.status(400).json({ error: "Use POST /projects/:id/complete to transition to COMPLETED" });
    return;
  }

  const data: Prisma.ProjectUpdateInput = {};
  if ("title" in body) data.title = String(body.title).trim();
  if ("status" in body && body.status !== ProjectStatus.COMPLETED) data.status = body.status as ProjectStatus;
  if ("startedAt" in body) data.startedAt = new Date(body.startedAt);
  if ("completedAt" in body) data.completedAt = body.completedAt ? new Date(body.completedAt) : null;
  if ("manualAuthor" in body) data.manualAuthor = body.manualAuthor ? String(body.manualAuthor).trim() : null;
  if ("manualDescription" in body) data.manualDescription = body.manualDescription ? String(body.manualDescription).trim() : null;
  if ("note" in body) data.note = body.note ? String(body.note) : null;

  if ("images" in body) {
    const images = validateImagesField(body.images, MAX_STASH_IMAGES_PER_SKEIN, "фото проекта");
    if (images === null) {
      res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото изделия/этапа` });
      return;
    }
    const check = validateNewStashImageOrigins(images);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    data.images = images;
  }
  if ("referencePhotos" in body) {
    const referencePhotos = validateImagesField(body.referencePhotos, MAX_STASH_IMAGES_PER_SKEIN, "референс");
    if (referencePhotos === null) {
      res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото референса` });
      return;
    }
    const check = validateNewStashImageOrigins(referencePhotos);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    data.referencePhotos = referencePhotos;
  }
  if ("links" in body) {
    const links = validateImagesField(body.links, MAX_STASH_IMAGES_PER_SKEIN, "ссылка");
    if (links === null) {
      res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} ссылок` });
      return;
    }
    data.links = links;
  }
  if ("finishedPhotos" in body) {
    // Редактирование формы проекта (не визард завершения) — фото изделия
    // можно поправить при любом статусе, тем же путём, что и при создании
    // (см. createProject выше).
    const finishedPhotos = validateImagesField(body.finishedPhotos, MAX_STASH_IMAGES_PER_SKEIN, "фото готовой работы");
    if (finishedPhotos === null) {
      res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото готовой работы` });
      return;
    }
    const check = validateNewStashImageOrigins(finishedPhotos);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    data.finishedPhotos = finishedPhotos;
  }

  // instruments — явная join-таблица (ProjectInstrument) с sizeMm, не
  // простое many-to-many, поэтому PATCH не может просто { set: [...] } —
  // нужно снести старые строки и создать новые (проще и надёжнее, чем
  // построчный diff/upsert, а порядок/уникальность строк тут не важны:
  // вся привязка инструментов заменяется формой целиком за один сабмит).
  let instrumentsUpdate: ProjectInstrumentInput[] | null = null;
  if ("instruments" in body) {
    instrumentsUpdate = parseInstrumentsInput(body.instruments);
  }
  if ("patternIds" in body) {
    const patternIds: string[] = Array.isArray(body.patternIds) ? body.patternIds.map(String) : [];
    const patterns = patternIds.length
      ? await prisma.pattern.findMany({
          where: { id: { in: patternIds } },
          select: { id: true, title: true, author: { select: { name: true } } },
        })
      : [];
    if (patternIds.length && patterns.length !== patternIds.length) {
      res.status(404).json({ error: "One or more patterns not found" });
      return;
    }
    await prisma.projectPattern.deleteMany({ where: { projectId: project.id } });
    if (patterns.length) {
      await prisma.projectPattern.createMany({
        data: patterns.map((p) => ({
          projectId: project.id,
          patternId: p.id,
          patternTitleSnapshot: p.title,
          patternAuthorSnapshot: p.author.name,
        })),
      });
    }
  }

  try {
    await prisma.project.update({ where: { id: project.id }, data });
    if (instrumentsUpdate !== null) {
      await prisma.projectInstrument.deleteMany({ where: { projectId: project.id } });
      if (instrumentsUpdate.length) {
        await prisma.projectInstrument.createMany({
          data: instrumentsUpdate.map((i) => ({ projectId: project.id, instrumentId: i.instrumentId, sizeMm: i.sizeMm })),
        });
      }
    }
    // Отдаём фронту полный ProjectDetail (с patterns/instruments/swatches/
    // documents и т.д.), а не голый Project — иначе AddProjectModal получает
    // объект без ожидаемых полей и падает молча (модалка не закрывается).
    const full = await prisma.project.findUnique({ where: { id: project.id }, include: PROJECT_DETAIL_INCLUDE });
    console.log(`[Projects] updateProject ok userId=${userId} projectId=${project.id} fields=${Object.keys(data).join(',')}`);
    res.json(full);
  } catch (error) {
    console.error(`[Projects] updateProject failed userId=${userId} projectId=${project.id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Завершение (§2.3/§3.1) ──────────────────────────────────────────────

/**
 * POST /projects/:id/complete — единый эндпоинт визарда завершения (все
 * 3 шага одним запросом, см. §3.1: промежуточные шаги — чисто клиентское
 * состояние, статус проекта не меняется до этого вызова).
 */
export const completeProject = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const userId = req.user!.userId;
  const body = req.body ?? {};

  const yarnUsagesInput: { skeinId: string; amountG?: number }[] = Array.isArray(body.yarnUsages)
    ? body.yarnUsages
        .filter((u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null)
        .map((u: Record<string, unknown>) => ({
          skeinId: String(u.skeinId),
          amountG:
            u.amountG === undefined || u.amountG === null || u.amountG === ""
              ? undefined
              : Number(u.amountG),
        }))
    : [];

  const finishedPhotos = validateImagesField(body.finishedPhotos, MAX_STASH_IMAGES_PER_SKEIN, "фото готовой работы");
  if (finishedPhotos === null) {
    res.status(400).json({ error: `Не более ${MAX_STASH_IMAGES_PER_SKEIN} фото готовой работы` });
    return;
  }
  const photosCheck = validateNewStashImageOrigins(finishedPhotos);
  if (!photosCheck.ok) {
    res.status(400).json({ error: photosCheck.error });
    return;
  }

  const patternIds: string[] | undefined = Array.isArray(body.patternIds) ? body.patternIds.map(String) : undefined;
  const manualAuthor = typeof body.manualAuthor === "string" ? body.manualAuthor.trim() || null : undefined;
  const manualDescription = typeof body.manualDescription === "string" ? body.manualDescription.trim() || null : undefined;
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  // Инструмент(ы) — тот же "мягкий" шаг 1 визарда завершения (материалы +
  // инструмент, PROJECTS_PLAN.md), что и yarnUsages выше. undefined — поле
  // не прислано, не трогать; [] — явно очистить.
  const instrumentsInput: ProjectInstrumentInput[] | undefined = body.instruments !== undefined
    ? parseInstrumentsInput(body.instruments)
    : undefined;

  try {
    // Владение мотков, упомянутых в yarnUsages, проверяем заранее — не
    // даём списать чужой моток через projectId, к которому он даже не
    // привязан (owned-проверка ProjectYarn ниже это тоже перехватит через
    // WHERE, но явная проверка даёт внятную ошибку).
    if (yarnUsagesInput.length) {
      const links = await prisma.projectYarn.findMany({
        where: { projectId: project.id, skeinId: { in: yarnUsagesInput.map((u) => u.skeinId) } },
        select: { skeinId: true },
      });
      const linkedIds = new Set(links.map((l) => l.skeinId));
      const unlinked = yarnUsagesInput.find((u) => !linkedIds.has(u.skeinId));
      if (unlinked) {
        res.status(400).json({ error: `Моток ${unlinked.skeinId} не привязан к этому проекту` });
        return;
      }
    }

    let patternsSnapshot: { title: string; authorName: string }[] = [];
    if (patternIds !== undefined && patternIds.length) {
      const patterns = await prisma.pattern.findMany({
        where: { id: { in: patternIds } },
        select: { id: true, title: true, author: { select: { name: true } } },
      });
      if (patterns.length !== patternIds.length) {
        res.status(404).json({ error: "One or more patterns not found" });
        return;
      }
      patternsSnapshot = patterns.map((p) => ({ title: p.title, authorName: p.author.name }));
    }

    await prisma.$transaction(async (tx) => {
      // Шаг 2: обновление названия/привязки к каталогу, если переданы.
      if (patternIds !== undefined) {
        await tx.projectPattern.deleteMany({ where: { projectId: project.id } });
        if (patternIds.length) {
          const patterns = await tx.pattern.findMany({
            where: { id: { in: patternIds } },
            select: { id: true, title: true, author: { select: { name: true } } },
          });
          await tx.projectPattern.createMany({
            data: patterns.map((p) => ({
              projectId: project.id,
              patternId: p.id,
              patternTitleSnapshot: p.title,
              patternAuthorSnapshot: p.author.name,
            })),
          });
        }
      }
      // Шаг 1 (материалы + инструмент): инструмент(ы), если переданы — тот
      // же deleteMany+createMany паттерн, что у instruments в updateProject
      // (join-таблица ProjectInstrument, PATCH не выразить простым set).
      if (instrumentsInput !== undefined) {
        await tx.projectInstrument.deleteMany({ where: { projectId: project.id } });
        if (instrumentsInput.length) {
          await tx.projectInstrument.createMany({
            data: instrumentsInput.map((i) => ({ projectId: project.id, instrumentId: i.instrumentId, sizeMm: i.sizeMm })),
          });
        }
      }

      const projectUpdateData: Prisma.ProjectUpdateInput = { finishedPhotos };
      if (title !== undefined) projectUpdateData.title = title;
      if (manualAuthor !== undefined) projectUpdateData.manualAuthor = manualAuthor;
      if (manualDescription !== undefined) projectUpdateData.manualDescription = manualDescription;

      // Шаг 1: расход по каждому мотку — 0/отсутствие поля/новое значение
      // (§2.3, §5.4: 0 = обнулить и удалить StashUsage, отсутствие поля =
      // не трогать).
      for (const u of yarnUsagesInput) {
        const existing = await tx.stashUsage.findUnique({
          where: { projectId_skeinId: { projectId: project.id, skeinId: u.skeinId } },
        });

        if (u.amountG === undefined) continue; // не трогать

        if (u.amountG === 0) {
          if (existing) {
            const affected = await tx.$executeRaw`
              UPDATE "StashSkein"
              SET "currentWeightG" = "currentWeightG" + ${existing.amountG}, "updatedAt" = now()
              WHERE id = ${u.skeinId} AND "currentWeightG" + ${existing.amountG} <= "totalWeightG"
            `;
            if (affected === 0) throw new InsufficientStashError(-1);
            await tx.stashUsage.delete({ where: { id: existing.id } });
            await tx.projectYarn.update({
              where: { projectId_skeinId: { projectId: project.id, skeinId: u.skeinId } },
              data: { amountAtCompletionG: null },
            });
            console.log(
              `[Projects] completeProject yarnReverted userId=${userId} projectId=${project.id} skeinId=${u.skeinId} returnedG=${existing.amountG}`
            );
          }
          continue;
        }

        const newAmount = u.amountG;
        const firstPatternSnapshot = patternsSnapshot[0];

        if (existing) {
          const delta = newAmount - existing.amountG;
          const affected = await tx.$executeRaw`
            UPDATE "StashSkein"
            SET "currentWeightG" = "currentWeightG" - ${delta}, "updatedAt" = now()
            WHERE id = ${u.skeinId}
              AND "currentWeightG" - ${delta} >= 0
              AND "currentWeightG" - ${delta} <= "totalWeightG"
          `;
          if (affected === 0) {
            const current = await tx.stashSkein.findUnique({ where: { id: u.skeinId }, select: { currentWeightG: true } });
            throw new InsufficientStashError(current?.currentWeightG ?? 0);
          }
          await tx.stashUsage.update({
            where: { id: existing.id },
            data: {
              amountG: newAmount,
              projectTitle: title ?? project.title,
              ...(firstPatternSnapshot
                ? { patternTitleSnapshot: firstPatternSnapshot.title, patternAuthorSnapshot: firstPatternSnapshot.authorName }
                : {}),
            },
          });
          console.log(
            `[Projects] completeProject yarnAdjusted userId=${userId} projectId=${project.id} skeinId=${u.skeinId} oldAmountG=${existing.amountG} newAmountG=${newAmount}`
          );
        } else {
          const affected = await tx.$executeRaw`
            UPDATE "StashSkein"
            SET "currentWeightG" = "currentWeightG" - ${newAmount}, "updatedAt" = now()
            WHERE id = ${u.skeinId} AND "currentWeightG" >= ${newAmount}
          `;
          if (affected === 0) {
            const current = await tx.stashSkein.findUnique({ where: { id: u.skeinId }, select: { currentWeightG: true } });
            throw new InsufficientStashError(current?.currentWeightG ?? 0);
          }
          await tx.stashUsage.create({
            data: {
              skeinId: u.skeinId,
              amountG: newAmount,
              projectId: project.id,
              isBackdatedCompletion: false,
              projectTitle: title ?? project.title,
              patternTitleSnapshot: firstPatternSnapshot?.title ?? project.manualDescription,
              patternAuthorSnapshot: firstPatternSnapshot?.authorName ?? project.manualAuthor,
            },
          });
          console.log(
            `[Projects] completeProject yarnCommitted userId=${userId} projectId=${project.id} skeinId=${u.skeinId} amountG=${newAmount}`
          );
        }

        await tx.projectYarn.update({
          where: { projectId_skeinId: { projectId: project.id, skeinId: u.skeinId } },
          data: { amountAtCompletionG: newAmount },
        });
      }

      await tx.project.update({
        where: { id: project.id },
        data: { ...projectUpdateData, status: ProjectStatus.COMPLETED, completedAt: project.completedAt ?? new Date() },
      });
    });

    console.log(`[Projects] completeProject ok userId=${userId} projectId=${project.id}`);
    const full = await prisma.project.findUnique({ where: { id: project.id }, include: PROJECT_DETAIL_INCLUDE });
    res.json(full);
  } catch (error) {
    if (error instanceof InsufficientStashError) {
      console.warn(
        `[Projects] completeProject insufficient userId=${userId} projectId=${project.id} currentWeightG=${error.currentWeightG}`
      );
      res.status(400).json({
        error: error.currentWeightG >= 0 ? `Недостаточно пряжи: осталось ${error.currentWeightG} г` : "Эта отмена уже была применена",
      });
      return;
    }
    console.error(`[Projects] completeProject failed userId=${userId} projectId=${project.id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Удаление (§2.5) ──────────────────────────────────────────────────────

/** DELETE /projects/:id — удаление, с явным выбором судьбы связанных списаний. */
export const deleteProject = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const userId = req.user!.userId;
  const body = req.body ?? {};
  const returnYarnToStash = Boolean(body.returnYarnToStash);

  try {
    await prisma.$transaction(async (tx) => {
      const usages = await tx.stashUsage.findMany({ where: { projectId: project.id } });

      if (returnYarnToStash) {
        for (const usage of usages) {
          if (usage.isBackdatedCompletion) {
            // Backdated-списание НИКОГДА не уменьшало currentWeightG (см.
            // createProject — расход компенсировался ростом totalWeightG,
            // currentWeightG оставался нетронутым). Отмена такого
            // списания симметрично должна трогать ТОЛЬКО totalWeightG —
            // currentWeightG += amountG здесь было бы вторым таким же
            // багом, что уже нашли и исправили в createProject (найдено
            // вручную при тестировании этого же прохода реализации).
            const affected = await tx.$executeRaw`
              UPDATE "StashSkein"
              SET "totalWeightG" = "totalWeightG" - ${usage.amountG}, "updatedAt" = now()
              WHERE id = ${usage.skeinId}
            `;
            if (affected === 0) {
              // Моток уже удалён из хранилища (skeinId живёт на StashUsage
              // без FK-каскада) — не баг, но стоит видеть при разборе
              // "почему totalWeightG не вернулся" из тестовой группы.
              console.warn(
                `[Projects] deleteProject backdatedRevert skeinMissing userId=${userId} projectId=${project.id} skeinId=${usage.skeinId}`
              );
            }
          } else {
            const affected = await tx.$executeRaw`
              UPDATE "StashSkein"
              SET "currentWeightG" = "currentWeightG" + ${usage.amountG}, "updatedAt" = now()
              WHERE id = ${usage.skeinId} AND "currentWeightG" + ${usage.amountG} <= "totalWeightG"
            `;
            if (affected === 0) {
              // Guard не прошёл (currentWeightG+amountG > totalWeightG,
              // либо моток удалён) — возврат веса молча не применился, а
              // StashUsage ниже всё равно удаляется. Не бросаем ошибку
              // (сохранён прежний, уже рабочий для пользователей, порядок
              // поведения — удаление проекта не должно блокироваться из-за
              // этого), но это разошедшийся currentWeightG, обязательно
              // смотреть при жалобе "остаток не совпадает".
              console.warn(
                `[Projects] deleteProject yarnReturn guardFailed userId=${userId} projectId=${project.id} skeinId=${usage.skeinId} amountG=${usage.amountG}`
              );
            }
          }
        }
        await tx.stashUsage.deleteMany({ where: { projectId: project.id } });
      } else {
        await tx.stashUsage.updateMany({ where: { projectId: project.id }, data: { projectId: null } });
      }

      // Каскадно унесёт ProjectPattern/ProjectYarn/ProjectSwatch/
      // ProjectDocument — только строки БД, файлы на диске остаются
      // (§5.5).
      await tx.project.delete({ where: { id: project.id } });
    });
    console.log(`[Projects] deleteProject ok userId=${userId} projectId=${project.id} returnYarnToStash=${returnYarnToStash}`);
    res.json({ ok: true });
  } catch (error) {
    console.error(`[Projects] deleteProject failed userId=${userId} projectId=${project.id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Привязка/отвязка (§2.4) ──────────────────────────────────────────────

export const addProjectPattern = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const patternId = String(req.body?.patternId ?? "");
  if (!patternId) {
    res.status(400).json({ error: "patternId is required" });
    return;
  }
  try {
    const pattern = await prisma.pattern.findUnique({
      where: { id: patternId },
      select: { id: true, title: true, author: { select: { name: true } } },
    });
    if (!pattern) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }
    const created = await prisma.projectPattern.create({
      data: {
        projectId: project.id,
        patternId: pattern.id,
        patternTitleSnapshot: pattern.title,
        patternAuthorSnapshot: pattern.author.name,
      },
    });
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "Паттерн уже привязан к проекту" });
      return;
    }
    console.error(`[Projects] addProjectPattern failed projectId=${project.id} patternId=${patternId}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const removeProjectPattern = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const { patternId } = req.params;
  try {
    await prisma.projectPattern.deleteMany({ where: { projectId: project.id, patternId } });
    res.json({ ok: true });
  } catch (error) {
    console.error(`[Projects] removeProjectPattern failed projectId=${project.id} patternId=${patternId}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const addProjectYarn = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const userId = req.user!.userId;
  const skeinId = String(req.body?.skeinId ?? "");
  if (!skeinId) {
    res.status(400).json({ error: "skeinId is required" });
    return;
  }
  try {
    const skein = await prisma.stashSkein.findUnique({
      where: { id: skeinId },
      select: { id: true, userId: true, yarnNameSnapshot: true, brandSnapshot: true },
    });
    if (!skein || skein.userId !== userId) {
      res.status(404).json({ error: "Skein not found" });
      return;
    }
    const created = await prisma.projectYarn.create({
      data: {
        projectId: project.id,
        skeinId: skein.id,
        yarnNameSnapshot: skein.yarnNameSnapshot,
        brandSnapshot: skein.brandSnapshot,
      },
    });
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "Моток уже привязан к проекту" });
      return;
    }
    console.error(`[Projects] addProjectYarn failed userId=${userId} projectId=${project.id} skeinId=${skeinId}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const removeProjectYarn = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const { skeinId } = req.params;
  try {
    await prisma.projectYarn.deleteMany({ where: { projectId: project.id, skeinId } });
    res.json({ ok: true });
  } catch (error) {
    console.error(`[Projects] removeProjectYarn failed projectId=${project.id} skeinId=${skeinId}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Точечные add/remove без указания sizeMm — размер, если нужен,
// правится через updateProject (полная замена instruments формой), эти
// два эндпоинта не используются текущим UI (AddProjectModal шлёт весь
// список сразу), оставлены для совместимости точечных интеграций.
export const addProjectInstrument = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const instrumentId = String(req.body?.instrumentId ?? "");
  if (!instrumentId) {
    res.status(400).json({ error: "instrumentId is required" });
    return;
  }
  try {
    await prisma.projectInstrument.upsert({
      where: { projectId_instrumentId: { projectId: project.id, instrumentId } },
      create: { projectId: project.id, instrumentId },
      update: {},
    });
    res.json({ ok: true });
  } catch (error) {
    console.error(`[Projects] addProjectInstrument failed projectId=${project.id} instrumentId=${instrumentId}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const removeProjectInstrument = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const { instrumentId } = req.params;
  try {
    await prisma.projectInstrument.deleteMany({ where: { projectId: project.id, instrumentId } });
    res.json({ ok: true });
  } catch (error) {
    console.error(`[Projects] removeProjectInstrument failed projectId=${project.id} instrumentId=${instrumentId}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Образцы проекта (§2.4, копия createSwatch/updateSwatch/deleteSwatch) ─

export const createProjectSwatch = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const body = req.body ?? {};

  const toDecimal = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
  const toInt = (v: unknown): number | null => (v == null || v === "" ? null : Math.trunc(Number(v)));

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
    const swatch = await prisma.projectSwatch.create({
      data: {
        projectId: project.id,
        images,
        needleSizeRaw: body.needleSizeRaw ? String(body.needleSizeRaw) : null,
        instrumentType: body.instrumentType === 'hook' || body.instrumentType === 'needle' ? body.instrumentType : null,
        strandsCount: toInt(body.strandsCount),
        densityStitchesBefore: toDecimal(body.densityStitchesBefore),
        densityRowsBefore: toDecimal(body.densityRowsBefore),
        densityStitchesAfter: toDecimal(body.densityStitchesAfter),
        densityRowsAfter: toDecimal(body.densityRowsAfter),
        note: body.note ? String(body.note) : null,
      },
    });
    res.status(201).json(swatch);
  } catch (error) {
    console.error(`[Projects] createProjectSwatch failed projectId=${project.id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateProjectSwatch = async (req: Request, res: Response): Promise<void> => {
  const id = req.projectSwatch!.id;
  const body = req.body ?? {};

  const toDecimal = (v: unknown): number | null | undefined =>
    v === undefined ? undefined : v == null || v === "" ? null : Number(v);
  const toInt = (v: unknown): number | null | undefined =>
    v === undefined ? undefined : v == null || v === "" ? null : Math.trunc(Number(v));

  const data: Prisma.ProjectSwatchUpdateInput = {};
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
  if ("instrumentType" in body) data.instrumentType = body.instrumentType === 'hook' || body.instrumentType === 'needle' ? body.instrumentType : null;
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
  if ("note" in body) data.note = body.note ? String(body.note) : null;

  try {
    const updated = await prisma.projectSwatch.update({ where: { id }, data });
    res.json(updated);
  } catch (error) {
    console.error(`[Projects] updateProjectSwatch failed swatchId=${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteProjectSwatch = async (req: Request, res: Response): Promise<void> => {
  const id = req.projectSwatch!.id;
  try {
    await prisma.projectSwatch.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error(`[Projects] deleteProjectSwatch failed swatchId=${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── PDF-описания (§8.1) ─────────────────────────────────────────────────

/**
 * POST /projects/:id/documents — принимает уже сохранённый multer'ом файл
 * (req.file, приватная директория, см. routes/projects.ts), проверяет
 * сигнатуру %PDF- (MIME из multipart легко подделать) и лимит на
 * количество файлов, создаёт строку ProjectDocument. Файл, не прошедший
 * проверку, удаляется с диска — иначе накапливался бы мусор от каждой
 * отклонённой попытки.
 */
export const uploadProjectDocument = async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const cleanup = () => fs.unlink(file.path, () => {});

  try {
    const existingCount = await prisma.projectDocument.count({ where: { projectId: project.id } });
    if (existingCount >= MAX_PROJECT_DOCUMENTS) {
      cleanup();
      res.status(400).json({ error: `Не более ${MAX_PROJECT_DOCUMENTS} файлов на проект` });
      return;
    }

    if (!hasPdfSignature(file.path)) {
      cleanup();
      res.status(400).json({ error: "Файл не является PDF" });
      return;
    }

    // multer/busboy декодирует multipart-заголовки как latin1 (RFC 7578 не
    // требует UTF-8, а Node исторически трактует их как binary) — не-ASCII
    // имя файла (кириллица и т.п.) приходит побайтово перепутанным.
    // Перекодировка обратно в UTF-8 восстанавливает исходную строку, если
    // клиент (браузер) на самом деле прислал её в UTF-8, что верно для
    // всех современных браузеров/WebView.
    const originalFileName = Buffer.from(file.originalname, "latin1").toString("utf8");

    const document = await prisma.projectDocument.create({
      data: {
        projectId: project.id,
        originalFileName,
        storedFileName: file.filename,
        fileSizeBytes: file.size,
      },
      select: { id: true, projectId: true, originalFileName: true, fileSizeBytes: true, createdAt: true },
    });
    res.status(201).json(document);
  } catch (error) {
    cleanup();
    console.error(`[Projects] uploadProjectDocument failed projectId=${project.id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /projects/documents/:id/file — авторизованная раздача (владение уже
 * проверено loadOwnedProjectDocument), НЕ через express.static.
 * Content-Disposition: inline — чтобы Telegram WebView открывал PDF в
 * месте (PdfViewerModal читает эти байты через pdf.js), не форсировал
 * скачивание.
 */
export const getProjectDocumentFile = async (req: Request, res: Response): Promise<void> => {
  const document = req.projectDocument!;
  const filePath = path.join(PROJECT_DOCUMENTS_DIR, document.storedFileName);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.originalFileName)}"`);
  res.sendFile(filePath, (error) => {
    if (error) {
      console.error(`[Projects] getProjectDocumentFile failed documentId=${document.id}:`, error);
      if (!res.headersSent) res.status(404).json({ error: "File not found" });
    }
  });
};

/**
 * DELETE /projects/documents/:id — убирает только строку из БД, файл на
 * диске остаётся (§8.1 — единое правило проекта для загруженных файлов,
 * не удалять физически).
 */
export const deleteProjectDocument = async (req: Request, res: Response): Promise<void> => {
  const id = req.projectDocument!.id;
  try {
    await prisma.projectDocument.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error(`[Projects] deleteProjectDocument failed documentId=${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Выделения текста в PDF (§8.2) ───────────────────────────────────────

function isValidRects(value: unknown): value is { x: number; y: number; width: number; height: number }[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (r) =>
        r &&
        typeof r === "object" &&
        typeof (r as Record<string, unknown>).x === "number" &&
        typeof (r as Record<string, unknown>).y === "number" &&
        typeof (r as Record<string, unknown>).width === "number" &&
        typeof (r as Record<string, unknown>).height === "number"
    )
  );
}

/** GET /projects/documents/:id/highlights — выделения для конкретной страницы (?page=N). */
export const listDocumentHighlights = async (req: Request, res: Response): Promise<void> => {
  const documentId = req.projectDocument!.id;
  const pageNumber = Number(req.query.page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    res.status(400).json({ error: "Invalid page" });
    return;
  }
  try {
    const highlights = await prisma.projectDocumentHighlight.findMany({
      where: { documentId, pageNumber },
      orderBy: { createdAt: "asc" },
    });
    res.json(highlights);
  } catch (error) {
    console.error(`[Projects] listDocumentHighlights failed documentId=${documentId} page=${pageNumber}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** POST /projects/documents/:id/highlights — создаёт выделение (координаты в системе PDF-страницы, не пикселей канваса). */
export const createDocumentHighlight = async (req: Request, res: Response): Promise<void> => {
  const documentId = req.projectDocument!.id;
  const body = req.body ?? {};

  const pageNumber = Number(body.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    res.status(400).json({ error: "Invalid pageNumber" });
    return;
  }
  if (!isValidRects(body.rects)) {
    res.status(400).json({ error: "Invalid rects" });
    return;
  }
  // Сервер не валидирует конкретное значение цвета (палитра — решение
  // фронта), только то, что это непустая строка разумной длины — не даём
  // записать произвольный мусор в поле.
  const color = typeof body.color === "string" ? body.color.trim() : "";
  if (!color || color.length > 32) {
    res.status(400).json({ error: "Invalid color" });
    return;
  }

  try {
    const highlight = await prisma.projectDocumentHighlight.create({
      data: { documentId, pageNumber, rects: body.rects, color },
    });
    res.status(201).json(highlight);
  } catch (error) {
    console.error(`[Projects] createDocumentHighlight failed documentId=${documentId} page=${pageNumber}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** DELETE /projects/documents/highlights/:id */
export const deleteDocumentHighlight = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    // Владение проверяем транзитивно через document -> project, тот же
    // паттерн что и остальные loadOwned* middleware, но без отдельного
    // middleware — единственный роут, оперирующий highlight по его
    // собственному :id, заводить ради него ещё один req.* было бы
    // избыточно.
    const highlight = await prisma.projectDocumentHighlight.findUnique({
      where: { id },
      include: { document: { include: { project: true } } },
    });
    if (!highlight) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === "ADMIN";
    if (!isAdmin && highlight.document.project.userId !== userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await prisma.projectDocumentHighlight.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error(`[Projects] deleteDocumentHighlight failed highlightId=${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Штрихи пера в PDF (§8.2) ────────────────────────────────────────────
// Отдельная от highlights модель (см. комментарий у ProjectDocumentDrawing
// в схеме) — произвольная рукописная линия, не привязанная к тексту, но
// тот же принцип хранения координат: единицы PDF-страницы, не пиксели
// канваса, переживает смену масштаба/DPI.

function isValidPoints(value: unknown): value is { x: number; y: number }[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(
      (p) =>
        p &&
        typeof p === "object" &&
        typeof (p as Record<string, unknown>).x === "number" &&
        typeof (p as Record<string, unknown>).y === "number"
    )
  );
}

/** GET /projects/documents/:id/drawings — штрихи пера для конкретной страницы (?page=N). */
export const listDocumentDrawings = async (req: Request, res: Response): Promise<void> => {
  const documentId = req.projectDocument!.id;
  const pageNumber = Number(req.query.page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    res.status(400).json({ error: "Invalid page" });
    return;
  }
  try {
    const drawings = await prisma.projectDocumentDrawing.findMany({
      where: { documentId, pageNumber },
      orderBy: { createdAt: "asc" },
    });
    res.json(drawings);
  } catch (error) {
    console.error(`[Projects] listDocumentDrawings failed documentId=${documentId} page=${pageNumber}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** POST /projects/documents/:id/drawings — создаёт один штрих (от pointerdown до pointerup). */
export const createDocumentDrawing = async (req: Request, res: Response): Promise<void> => {
  const documentId = req.projectDocument!.id;
  const body = req.body ?? {};

  const pageNumber = Number(body.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    res.status(400).json({ error: "Invalid pageNumber" });
    return;
  }
  if (!isValidPoints(body.points)) {
    res.status(400).json({ error: "Invalid points" });
    return;
  }

  try {
    const drawing = await prisma.projectDocumentDrawing.create({
      data: { documentId, pageNumber, points: body.points },
    });
    res.status(201).json(drawing);
  } catch (error) {
    console.error(`[Projects] createDocumentDrawing failed documentId=${documentId} page=${pageNumber}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** DELETE /projects/documents/drawings/:id */
export const deleteDocumentDrawing = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    // Владение проверяем транзитивно через document -> project, тот же
    // паттерн, что и deleteDocumentHighlight выше.
    const drawing = await prisma.projectDocumentDrawing.findUnique({
      where: { id },
      include: { document: { include: { project: true } } },
    });
    if (!drawing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === "ADMIN";
    if (!isAdmin && drawing.document.project.userId !== userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await prisma.projectDocumentDrawing.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error(`[Projects] deleteDocumentDrawing failed drawingId=${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};
