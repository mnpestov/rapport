/**
 * Справочник артикулов пряжи и связи описаний с ним — админская часть
 * (Этап 4 плана YARN_ARTICLES_PLAN.md).
 *
 * Поиск везде идёт по `normalizedKey` и `YarnAlias.normalizedAlias`, а не по
 * `name ILIKE`: авторы пишут «ализе» и «Alize», «Сеам» и «Seam», и без
 * приведения к одному алфавиту половина запросов не находит ничего.
 */
import { Request, Response } from "express";
import { Prisma, YarnLinkSource, YarnLinkStatus, YarnMatchRule, YarnStatus } from "@prisma/client";
import { prisma } from "../prismaClient";
import { normalizeYarnKey, yarnDedupKey } from "../utils/yarnKeys";

const PAGE_SIZE = 50;

// Что отдаём наружу. Сырые строки характеристик идут рядом с разобранными
// числами: строку показываем человеку («4,5—5 мм»), числа нужны фильтрам.
const YARN_SELECT = {
  id: true, brand: true, line: true, name: true, isGeneric: true,
  mPer100g: true, composition: true, needleSizeRaw: true,
  densityRaw: true, ballWeightG: true, ballLengthM: true,
  sourceName: true, sourceUrl: true, isActive: true, mergedIntoId: true,
  status: true,
  aliases: { select: { id: true, alias: true } },
  _count: { select: { patterns: true } },
} satisfies Prisma.YarnSelect;

export async function listYarns(req: Request, res: Response) {
  const q = String(req.query.q || "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const noMetrage = req.query.noMetrage === "1";
  const genericOnly = req.query.generic === "1";
  // Очередь модерации (implementation_plan_moderation_yarns_articles.md
  // §3/§4) — артикулы, созданные авторами через POST /author/yarns, ждущие
  // одобрения. Не сочетается по смыслу с mergedIntoId: null ниже (PENDING
  // никогда не бывает слит), но фильтр всё равно применяется одинаково —
  // безвредно, слитых PENDING-карточек не бывает.
  const pendingOnly = req.query.pending === "1";

  const where: Prisma.YarnWhereInput = { mergedIntoId: null };
  if (noMetrage) where.mPer100g = null;
  if (genericOnly) where.isGeneric = true;
  if (pendingOnly) where.status = YarnStatus.PENDING;
  if (q) {
    const key = normalizeYarnKey(q);
    // Пустой ключ означает, что в запросе не было ни букв, ни цифр —
    // подставлять его в contains нельзя, найдётся весь справочник.
    where.OR = key
      ? [
          { normalizedKey: { contains: key } },
          { aliases: { some: { normalizedAlias: { contains: key } } } },
        ]
      : [{ name: { contains: q, mode: "insensitive" } }];
  }

  const [items, total] = await Promise.all([
    prisma.yarn.findMany({
      where,
      select: YARN_SELECT,
      orderBy: [{ patterns: { _count: "desc" } }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.yarn.count({ where }),
  ]);
  res.json({ items, total, page, pageSize: PAGE_SIZE });
}

/**
 * Подсказка для формы описания. От трёх символов и не длиннее двадцати
 * позиций: 2123 карточки из 2778 не привязаны ни к одному описанию, и без
 * сортировки по числу связей сверху оказывался бы шум.
 */
export async function suggestYarns(req: Request, res: Response) {
  const q = String(req.query.q || "").trim();
  if (q.length < 3) return res.json({ items: [] });
  const key = normalizeYarnKey(q);
  if (!key) return res.json({ items: [] });

  const items = await prisma.yarn.findMany({
    where: {
      mergedIntoId: null,
      isActive: true,
      // Не показываем PENDING никому, включая создавшего автора — он уже
      // получил связь напрямую при создании, не через поиск (см. plan §
      // Open Questions).
      status: YarnStatus.APPROVED,
      OR: [
        { normalizedKey: { contains: key } },
        { aliases: { some: { normalizedAlias: { contains: key } } } },
      ],
    },
    select: {
      id: true, name: true, brand: true, mPer100g: true, composition: true,
      // normalizedKey уходит наружу не для показа: выбранное в модалке
      // новинки лежит в parsedData до одобрения, и резолвить его потом надо
      // по ключу — id к тому времени может указывать на слитую карточку.
      normalizedKey: true,
      isGeneric: true, _count: { select: { patterns: true } },
    },
    orderBy: [{ patterns: { _count: "desc" } }, { name: "asc" }],
    take: 20,
  });
  res.json({ items });
}

function yarnFields(body: Record<string, unknown>) {
  const name = String(body.name || "").trim();
  return {
    name,
    brand: body.brand ? String(body.brand).trim() : null,
    line: body.line ? String(body.line).trim() : null,
    isGeneric: Boolean(body.isGeneric),
    mPer100g: body.mPer100g == null || body.mPer100g === "" ? null : Number(body.mPer100g),
    composition: body.composition ? String(body.composition) : null,
    needleSizeRaw: body.needleSizeRaw ? String(body.needleSizeRaw) : null,
    densityRaw: body.densityRaw ? String(body.densityRaw) : null,
    ballWeightG: body.ballWeightG == null || body.ballWeightG === "" ? null : Number(body.ballWeightG),
    ballLengthM: body.ballLengthM == null || body.ballLengthM === "" ? null : Number(body.ballLengthM),
    sourceName: body.sourceName ? String(body.sourceName) : null,
    sourceUrl: body.sourceUrl ? String(body.sourceUrl) : null,
  };
}

export async function createYarn(req: Request, res: Response) {
  const data = yarnFields(req.body);
  if (!data.name) return res.status(400).json({ error: "Название обязательно" });
  // У родовых карточек бренда нет и быть не может — это категория, а не
  // товар. Требовать его от них нельзя (§3.7).
  if (!data.isGeneric && !data.brand) {
    return res.status(400).json({ error: "Укажите бренд или отметьте карточку родовой" });
  }
  const normalizedKey = normalizeYarnKey(data.name);
  const existing = await prisma.yarn.findUnique({
    where: { normalizedKey },
    select: { id: true, name: true },
  });
  if (existing) {
    return res.status(409).json({ error: `Такой артикул уже есть: «${existing.name}»`, id: existing.id });
  }
  const yarn = await prisma.yarn.create({
    data: { ...data, normalizedKey, dedupKey: yarnDedupKey(data.name) },
    select: YARN_SELECT,
  });
  res.status(201).json(yarn);
}

/**
 * POST /author/yarns — тот же путь создания, что createYarn выше (одна и та
 * же валидация и хелперы), но status жёстко ставится PENDING и никогда не
 * читается из req.body: иначе автор мог бы прислать `status: "APPROVED"`
 * напрямую и обойти модерацию (implementation_plan_moderation_yarns_articles.md
 * Verification Plan, шаг 8).
 */
export async function createAuthorYarn(req: Request, res: Response) {
  const data = yarnFields(req.body);
  if (!data.name) return res.status(400).json({ error: "Название обязательно" });
  if (!data.isGeneric && !data.brand) {
    return res.status(400).json({ error: "Укажите бренд или отметьте карточку родовой" });
  }
  const normalizedKey = normalizeYarnKey(data.name);
  const existing = await prisma.yarn.findUnique({
    where: { normalizedKey },
    select: { id: true, name: true },
  });
  if (existing) {
    return res.status(409).json({ error: `Такой артикул уже есть: «${existing.name}»`, id: existing.id });
  }
  const yarn = await prisma.yarn.create({
    data: { ...data, normalizedKey, dedupKey: yarnDedupKey(data.name), status: YarnStatus.PENDING },
    select: YARN_SELECT,
  });
  res.status(201).json(yarn);
}

export async function updateYarn(req: Request, res: Response) {
  const data = yarnFields(req.body);
  if (!data.name) return res.status(400).json({ error: "Название обязательно" });
  const normalizedKey = normalizeYarnKey(data.name);
  const clash = await prisma.yarn.findUnique({ where: { normalizedKey }, select: { id: true, name: true } });
  if (clash && clash.id !== req.params.id) {
    return res.status(409).json({ error: `Ключ занят артикулом «${clash.name}»` });
  }
  const yarn = await prisma.yarn.update({
    where: { id: req.params.id },
    data: { ...data, normalizedKey, dedupKey: yarnDedupKey(data.name) },
    select: YARN_SELECT,
  });
  res.json(yarn);
}

/**
 * Слияние дублей. Карточка-источник не удаляется, а помечается ссылкой на
 * победителя: связи на неё уже разошлись по описаниям, и удаление порвало бы
 * их. Имя источника уезжает в псевдонимы — автор мог написать именно так.
 */
export async function mergeYarn(req: Request, res: Response) {
  const { id } = req.params;
  const targetId = String(req.body.targetId || "");
  if (!targetId || targetId === id) {
    return res.status(400).json({ error: "Нужна другая карточка-приёмник" });
  }
  const [src, dst] = await Promise.all([
    prisma.yarn.findUnique({ where: { id }, select: { id: true, name: true, aliases: true } }),
    prisma.yarn.findUnique({ where: { id: targetId }, select: { id: true } }),
  ]);
  if (!src || !dst) return res.status(404).json({ error: "Карточка не найдена" });

  await prisma.$transaction(async (tx) => {
    // Описание могло ссылаться на обе карточки сразу — тогда перенос нарушит
    // UNIQUE(patternId, yarnId). Такие связи просто удаляем: цель уже
    // связана, и вторая строка ничего не добавляет.
    const dup = await tx.patternYarn.findMany({
      where: { yarnId: id, pattern: { yarns: { some: { yarnId: targetId } } } },
      select: { id: true },
    });
    if (dup.length) {
      await tx.patternYarn.deleteMany({ where: { id: { in: dup.map((d) => d.id) } } });
    }
    await tx.patternYarn.updateMany({ where: { yarnId: id }, data: { yarnId: targetId } });

    // Same dedup reasoning as PatternYarn above, but for open drafts (a
    // draft can reference the merge source before it's ever published).
    const draftDup = await tx.draftYarn.findMany({
      where: { yarnId: id, draft: { yarns: { some: { yarnId: targetId } } } },
      select: { id: true },
    });
    if (draftDup.length) {
      await tx.draftYarn.deleteMany({ where: { id: { in: draftDup.map((d) => d.id) } } });
    }
    await tx.draftYarn.updateMany({ where: { yarnId: id }, data: { yarnId: targetId } });

    await tx.patternYarnMention.updateMany({ where: { suggestedYarnId: id }, data: { suggestedYarnId: targetId } });
    await tx.patternYarnMention.updateMany({ where: { resolvedYarnId: id }, data: { resolvedYarnId: targetId } });

    for (const alias of [{ alias: src.name }, ...src.aliases]) {
      const normalizedAlias = normalizeYarnKey(alias.alias);
      if (!normalizedAlias) continue;
      const taken = await tx.yarnAlias.findUnique({ where: { normalizedAlias }, select: { id: true } });
      if (taken) continue;
      await tx.yarnAlias.create({ data: { yarnId: targetId, alias: alias.alias, normalizedAlias } });
    }
    await tx.yarnAlias.deleteMany({ where: { yarnId: id } });
    await tx.yarn.update({ where: { id }, data: { mergedIntoId: targetId, isActive: false } });
  });
  res.json({ ok: true, movedTo: targetId });
}

/**
 * Одобрение PENDING-артикула (implementation_plan_moderation_yarns_articles.md
 * §"Proposed Changes" 2). Guard на статус: повторное одобрение или попытка
 * "одобрить" уже APPROVED-карточку — 409, не тихий no-op, чтобы админ
 * заметил, что кликнул на устаревшую строку в очереди.
 */
export async function approveYarn(req: Request, res: Response) {
  const yarn = await prisma.yarn.findUnique({ where: { id: req.params.id }, select: { status: true } });
  if (!yarn) return res.status(404).json({ error: "Карточка не найдена" });
  if (yarn.status !== YarnStatus.PENDING) {
    return res.status(409).json({ error: "Артикул уже не на проверке" });
  }
  const approved = await prisma.yarn.update({
    where: { id: req.params.id },
    data: { status: YarnStatus.APPROVED },
    select: YARN_SELECT,
  });
  res.json(approved);
}

/**
 * Отклонение PENDING-артикула — plan §2 Вариант B, fallback для явного
 * мусора/опечаток, которые не с чем слить через mergeYarn (Вариант A,
 * основной путь, уже покрыт существующей mergeYarn выше). Не переиспользует
 * deleteYarn: тот намеренно блокирует удаление при наличии связей (409,
 * "слейте его с другим или снимите связи") — здесь ровно наоборот, снятие
 * связей явно входит в контракт отклонения, а не считается ошибкой.
 */
export async function rejectPendingYarn(req: Request, res: Response) {
  const { id } = req.params;
  const yarn = await prisma.yarn.findUnique({ where: { id }, select: { status: true } });
  if (!yarn) return res.status(404).json({ error: "Карточка не найдена" });
  if (yarn.status !== YarnStatus.PENDING) {
    return res.status(409).json({ error: "Отклонить можно только артикул на проверке" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.patternYarn.deleteMany({ where: { yarnId: id } });
    // DraftYarn.yarn has no onDelete: Cascade (RESTRICT, like PatternYarn) —
    // a PENDING yarn picked in an open draft's form but not yet published
    // would otherwise block yarn.delete below with a FK violation.
    await tx.draftYarn.deleteMany({ where: { yarnId: id } });
    await tx.patternYarnMention.updateMany({ where: { suggestedYarnId: id }, data: { suggestedYarnId: null } });
    await tx.patternYarnMention.updateMany({ where: { resolvedYarnId: id }, data: { resolvedYarnId: null } });
    await tx.yarnAlias.deleteMany({ where: { yarnId: id } });
    await tx.yarn.delete({ where: { id } });
  });
  res.json({ ok: true });
}

export async function deleteYarn(req: Request, res: Response) {
  const { id } = req.params;
  // DraftYarn has the same FK shape as PatternYarn (no onDelete: Cascade) —
  // an artikul picked in an open draft's form, not yet published, blocks
  // yarn.delete() below just as much as a PatternYarn link does. Missed
  // this the first time DraftYarn was added (only rejectPendingYarn was
  // updated), which is exactly how this constraint violation happened.
  const [patternLinks, draftLinks] = await Promise.all([
    prisma.patternYarn.count({ where: { yarnId: id } }),
    prisma.draftYarn.count({ where: { yarnId: id } }),
  ]);
  const links = patternLinks + draftLinks;
  if (links) {
    return res.status(409).json({
      error: `Артикул связан с ${links} описан${links === 1 ? "ием" : "иями"} (включая черновики) — слейте его с другим или снимите связи`,
    });
  }
  await prisma.yarn.delete({ where: { id } });
  res.json({ ok: true });
}

// ─── Связи описания ────────────────────────────────────────────────────────

export async function getPatternYarns(req: Request, res: Response) {
  const patternId = req.params.id;
  const [links, mentions] = await Promise.all([
    prisma.patternYarn.findMany({
      where: { patternId, status: YarnLinkStatus.ACTIVE },
      select: {
        id: true, source: true, matchRule: true, rawMention: true, metrageInText: true,
        yarn: { select: { id: true, name: true, brand: true, mPer100g: true, composition: true, isGeneric: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.patternYarnMention.findMany({
      where: { patternId, status: "PENDING" },
      select: { id: true, rawText: true, metrageInText: true, kind: true, suggestedYarnId: true },
      orderBy: { rawText: "asc" },
    }),
  ]);
  res.json({ links, mentions });
}

/**
 * Полная замена набора связей описания.
 *
 * Снятая связь не удаляется, а переводится в REJECTED, если её создал
 * бэкофил: текст описания не менялся, разбор даст тот же результат, и
 * следующий прогон вернул бы её обратно. Модератор удалял бы одно и то же
 * по кругу. Связи, заведённые руками, удаляются насовсем — их
 * воскрешать некому.
 */
export async function setPatternYarns(req: Request, res: Response) {
  const patternId = req.params.id;
  const ids: string[] = Array.isArray(req.body.yarnIds) ? req.body.yarnIds.map(String) : [];

  await prisma.$transaction(async (tx) => {
    const current = await tx.patternYarn.findMany({
      where: { patternId },
      select: { id: true, yarnId: true, source: true, status: true },
    });
    const keep = new Set(ids);

    for (const link of current) {
      if (keep.has(link.yarnId)) {
        // Вернули то, что раньше отвергли — снимаем надгробие.
        if (link.status === YarnLinkStatus.REJECTED) {
          await tx.patternYarn.update({
            where: { id: link.id },
            data: { status: YarnLinkStatus.ACTIVE, source: YarnLinkSource.ADMIN },
          });
        }
        keep.delete(link.yarnId);
        continue;
      }
      if (link.status === YarnLinkStatus.REJECTED) continue;
      if (link.source === YarnLinkSource.BACKFILL || link.source === YarnLinkSource.SCRAPER) {
        await tx.patternYarn.update({ where: { id: link.id }, data: { status: YarnLinkStatus.REJECTED } });
      } else {
        await tx.patternYarn.delete({ where: { id: link.id } });
      }
    }

    if (keep.size) {
      await tx.patternYarn.createMany({
        data: [...keep].map((yarnId) => ({
          patternId, yarnId,
          source: YarnLinkSource.ADMIN,
          matchRule: YarnMatchRule.MANUAL,
        })),
        skipDuplicates: true,
      });
    }
  });
  res.json({ ok: true });
}

/** Упоминание разобрано человеком: либо привязано к артикулу, либо отклонено. */
export async function resolveMention(req: Request, res: Response) {
  const { id } = req.params;
  const yarnId = req.body.yarnId ? String(req.body.yarnId) : null;
  const mention = await prisma.patternYarnMention.findUnique({
    where: { id },
    select: { patternId: true },
  });
  if (!mention) return res.status(404).json({ error: "Упоминание не найдено" });

  await prisma.$transaction(async (tx) => {
    if (yarnId) {
      await tx.patternYarn.upsert({
        where: { patternId_yarnId: { patternId: mention.patternId, yarnId } },
        create: {
          patternId: mention.patternId, yarnId,
          source: YarnLinkSource.ADMIN, matchRule: YarnMatchRule.MANUAL,
        },
        update: { status: YarnLinkStatus.ACTIVE, source: YarnLinkSource.ADMIN },
      });
    }
    await tx.patternYarnMention.update({
      where: { id },
      data: { status: yarnId ? "RESOLVED" : "REJECTED", resolvedYarnId: yarnId },
    });
  });
  res.json({ ok: true });
}
