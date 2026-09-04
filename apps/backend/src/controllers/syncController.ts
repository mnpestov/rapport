import { Request, Response } from "express";
import {
  Prisma,
  YarnLinkSource,
  YarnMatchRule,
  YarnMentionKind,
} from "@prisma/client";
import { prisma } from "../prismaClient";
import { generateSlug } from "../utils/slug";
import path from "path";
import fs from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { spawn } from "child_process";
import { syncCategories, syncTags, syncInstruments, normalizeQuotes } from "../utils/adminShared";
import { validateImages, validateNewImageOrigins, diffImages, deriveImageUrl, MAX_PATTERN_IMAGES } from "../utils/patternImages";
import { generateThumbnailUrl } from "../utils/imagePipeline";

let isSyncing = false;
// Author.id currently being synced, or null when a full (all-authors) sync
// is running. Only one sync — full or single-author — runs at a time; they
// share isSyncing as a lock since main() does a global URL-dedup prefetch
// and writes via a single DB connection regardless of scope.
let syncingAuthorId: string | null = null;
const SOCIAL_SITE_PATTERN = /t\.me|vk\.com|instagram\.com/i;

/**
 * Артикулы пряжи, найденные скрапером, — в связи описания.
 *
 * Резолвим по `normalizedKey`, а `id` из `parsedData` служит только
 * подсказкой: между скрапом и одобрением карточку могли слить или скрыть.
 * `connect` по мёртвому id бросил бы исключение прямо посреди
 * processSyncBatch, а он на ошибке отвечает 400 в середине цикла по
 * элементам — часть пачки к тому моменту уже записана, и откатывать нечем.
 * Ключ переживает слияние: у карточки-приёмника он тот же.
 *
 * Не нашлось — не теряем: название уходит в PatternYarnMention, по которому
 * потом видно, чего справочнику не хватает.
 */
/**
 * Нормализовать список артикулов, пришедший из админки, к тому же виду, в
 * каком его пишет скрапер: id, имя и ключ. Ключ и имя берём из БД по id —
 * присланному клиенту доверять в этих полях нечего, а резолв при одобрении
 * идёт именно по ключу.
 */
async function resolveYarnPayload(yarns: any[]) {
  const ids = yarns.map((y) => String(y?.id || "")).filter(Boolean);
  if (!ids.length) return [];
  const cards = await prisma.yarn.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, normalizedKey: true },
  });
  const byId = new Map(cards.map((c) => [c.id, c]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((c) => ({
      id: c!.id,
      name: c!.name,
      normalizedKey: c!.normalizedKey,
      rawMention: null,
      metrageInText: null,
      // Выбор человека, а не срабатывание правила.
      matchRule: YarnMatchRule.MANUAL,
    }));
}

/**
 * Толщина пряжи (диапазон м/100 г) из артикулов, когда скрапер её сам не
 * нашёл. Зеркалит автоподстановку в форме описания
 * (admin Patterns.tsx: при выборе артикула известного метража
 * подставляется соответствующий YarnRange).
 *
 * Срабатывает ТОЛЬКО если у новинки нет своих yarnRanges: то, что нашёл
 * скрапер или проставил модератор, приоритетнее. Берём первый артикул с
 * заполненным mPer100g (у трети карточек его нет — их просто пропускаем),
 * слитые карточки резолвим на победителя.
 */
async function deriveYarnRangeIdsFromArticles(parsedData: any): Promise<string[]> {
  const scraped: any[] = Array.isArray(parsedData?.yarns) ? parsedData.yarns : [];
  const keys = scraped.map((y) => String(y?.normalizedKey || "")).filter(Boolean);
  if (keys.length === 0) return [];

  const cards = await prisma.yarn.findMany({
    where: { normalizedKey: { in: keys } },
    select: { normalizedKey: true, mPer100g: true, mergedIntoId: true },
  });
  const byKey = new Map(cards.map((c) => [c.normalizedKey, c]));

  // Метраж у победителя слияния, если карточка слита.
  const winnerIds = Array.from(
    new Set(cards.map((c) => c.mergedIntoId).filter((v): v is string => !!v))
  );
  const winners = winnerIds.length
    ? await prisma.yarn.findMany({
        where: { id: { in: winnerIds } },
        select: { id: true, mPer100g: true },
      })
    : [];
  const winnerById = new Map(winners.map((w) => [w.id, w]));

  // Первый по порядку из parsedData артикул с известным метражом.
  let metrage: number | null = null;
  for (const y of scraped) {
    const card = byKey.get(String(y?.normalizedKey || ""));
    if (!card) continue;
    const m = card.mergedIntoId
      ? winnerById.get(card.mergedIntoId)?.mPer100g ?? null
      : card.mPer100g;
    if (m != null) {
      metrage = m;
      break;
    }
  }
  if (metrage == null) return [];

  const ranges = await prisma.yarnRange.findMany({
    where: {
      minValue: { lte: metrage },
      OR: [{ maxValue: null }, { maxValue: { gte: metrage } }],
    },
    select: { id: true },
  });
  return ranges.map((r) => r.id);
}

export async function attachScrapedYarns(
  tx: Prisma.TransactionClient,
  patternId: string,
  parsedData: any,
) {
  const scraped: any[] = Array.isArray(parsedData?.yarns) ? parsedData.yarns : [];
  const mentions: any[] = Array.isArray(parsedData?.yarnMentions) ? parsedData.yarnMentions : [];
  if (!scraped.length && !mentions.length) return;

  const keys = scraped.map((y) => String(y.normalizedKey || "")).filter(Boolean);
  const cards = keys.length
    ? await tx.yarn.findMany({
        where: { normalizedKey: { in: keys } },
        select: { id: true, normalizedKey: true, mergedIntoId: true },
      })
    : [];
  const byKey = new Map(cards.map((c) => [c.normalizedKey, c]));

  const links: { yarnId: string; y: any }[] = [];
  const lost: any[] = [];
  for (const y of scraped) {
    const card = byKey.get(String(y.normalizedKey || ""));
    // Слитая карточка ведёт к победителю — связь должна попасть на него.
    const yarnId = card ? card.mergedIntoId ?? card.id : null;
    if (yarnId) links.push({ yarnId, y });
    else lost.push({ rawText: y.name || y.rawMention, metrageInText: y.metrageInText, kind: "UNKNOWN_ARTICLE" });
  }

  if (links.length) {
    await tx.patternYarn.createMany({
      data: links.map(({ yarnId, y }) => ({
        patternId,
        yarnId,
        rawMention: y.rawMention ?? null,
        metrageInText: y.metrageInText ?? null,
        source: YarnLinkSource.SCRAPER,
        matchRule: (y.matchRule as YarnMatchRule) ?? null,
      })),
      skipDuplicates: true,
    });
  }

  const allMentions = [...mentions, ...lost].filter((m) => m.rawText);
  if (allMentions.length) {
    await tx.patternYarnMention.createMany({
      data: allMentions.map((m) => ({
        patternId,
        rawText: String(m.rawText),
        metrageInText: m.metrageInText ?? null,
        kind: (m.kind as YarnMentionKind) ?? YarnMentionKind.UNKNOWN_ARTICLE,
      })),
      skipDuplicates: true,
    });
  }
}

export const getPendingReports = async (req: Request, res: Response) => {
  // Выборка только PENDING отчетов для бейджа.
  // author.removalRequested = false: автор, попросивший удаления, не должен
  // светиться новинками в очереди модерации. Отчёты и items не удаляются —
  // снятие флага возвращает их сюда (парсинг всё это время шёл как обычно).
  const reports = await prisma.authorSyncReport.findMany({
    where: {
      status: "PENDING",
      author: { removalRequested: false },
    },
    select: {
      id: true,
      authorId: true,
      _count: { select: { items: { where: { status: "PENDING" } } } }
    }
  });
  const formatted = reports
    .filter(r => r._count.items > 0)
    .map(r => ({
      id: r.id,
      authorId: r.authorId,
      itemsCount: r._count.items
    }));
  res.json(formatted);
};

export const getReportById = async (req: Request, res: Response) => {
  const { reportId } = req.params;
  const report = await prisma.authorSyncReport.findUnique({
    where: { id: reportId },
    include: { items: { where: { status: "PENDING" } } }
  });
  if (!report) {
    return res.json(report);
  }

  // Артикулы в parsedData от скрапера несут id/name/normalizedKey, но НЕ
  // метраж. Дотягиваем mPer100g из справочника, чтобы админка могла
  // показать его в чипе и автоподставить толщину при ручной правке, как в
  // форме описания. Ключ переживает слияние — метраж берём у победителя.
  const allKeys = new Set<string>();
  for (const it of report.items) {
    const ys = (it.parsedData as any)?.yarns;
    if (Array.isArray(ys)) for (const y of ys) {
      if (y?.normalizedKey) allKeys.add(String(y.normalizedKey));
    }
  }
  if (allKeys.size > 0) {
    const cards = await prisma.yarn.findMany({
      where: { normalizedKey: { in: Array.from(allKeys) } },
      select: { normalizedKey: true, mPer100g: true, mergedIntoId: true },
    });
    const winnerIds = Array.from(
      new Set(cards.map((c) => c.mergedIntoId).filter((v): v is string => !!v))
    );
    const winners = winnerIds.length
      ? await prisma.yarn.findMany({
          where: { id: { in: winnerIds } },
          select: { id: true, mPer100g: true },
        })
      : [];
    const winnerById = new Map(winners.map((w) => [w.id, w.mPer100g]));
    const metrageByKey = new Map(
      cards.map((c) => [
        c.normalizedKey,
        c.mergedIntoId ? winnerById.get(c.mergedIntoId) ?? null : c.mPer100g,
      ])
    );
    for (const it of report.items) {
      const ys = (it.parsedData as any)?.yarns;
      if (Array.isArray(ys)) {
        for (const y of ys) {
          if (y?.normalizedKey && metrageByKey.has(String(y.normalizedKey))) {
            y.mPer100g = metrageByKey.get(String(y.normalizedKey)) ?? null;
          }
        }
      }
    }
  }

  res.json(report);
};

// PATCH /admin/sync-items/:itemId — persists admin edits to a pending novelty
// item BEFORE it's approved (processSyncBatch always re-reads title/url/parsedData
// fresh from the DB row, so edits saved here take effect on the next approve).
export const updateSyncItem = async (req: Request, res: Response) => {
  const { itemId } = req.params;
  const { title, url, images, details, price, oldPrice, isFree, isNew, densityStitches, densityRows, categories, tags, instruments, yarnRangeIds, yarns } = req.body;

  const existing = await prisma.authorSyncItem.findUnique({ where: { id: itemId } });
  if (!existing) {
    return res.status(404).json({ error: "Item not found" });
  }

  const { imageUrl: _legacyImageUrl, ...prevParsedData } = (existing.parsedData as any) || {};
  // Legacy fallback: items scraped before this field existed only have
  // imageUrl (see pattern_images_plan.md риски №1/2).
  const prevImages: string[] = Array.isArray(prevParsedData.images) && prevParsedData.images.length > 0
    ? prevParsedData.images
    : (_legacyImageUrl ? [_legacyImageUrl] : []);

  let newImages = prevImages;
  if (images !== undefined) {
    const validation = validateImages(images);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    // Only newly-added entries must be our own uploads — unedited images
    // still pointing at the author's own site (never downloaded yet) are
    // legitimate and must pass through untouched.
    const { added } = diffImages(prevImages, validation.images);
    const originCheck = validateNewImageOrigins(added);
    if (!originCheck.ok) {
      return res.status(400).json({ error: originCheck.error });
    }
    newImages = validation.images;
  }

  const [catIds, tagIds, instIds] = await Promise.all([
    syncCategories(Array.isArray(categories) ? categories : []),
    syncTags(Array.isArray(tags) ? tags : []),
    syncInstruments(Array.isArray(instruments) ? instruments : []),
  ]);

  const [categoryRecords, tagRecords, instrumentRecords, yarnRangeRecords] = await Promise.all([
    prisma.productType.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } }),
    prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true, name: true } }),
    prisma.instrument.findMany({ where: { id: { in: instIds } }, select: { id: true, name: true } }),
    prisma.yarnRange.findMany({ where: { id: { in: Array.isArray(yarnRangeIds) ? yarnRangeIds : [] } }, select: { id: true, label: true } }),
  ]);

  const parsedData = {
    ...prevParsedData,
    images: newImages,
    details: details ?? null,
    price: price === "" || price === undefined || price === null ? null : Number(price),
    oldPrice: oldPrice === "" || oldPrice === undefined || oldPrice === null ? null : Number(oldPrice),
    isFree: !!isFree,
    isNew: !!isNew,
    densityStitches: densityStitches === "" || densityStitches === undefined || densityStitches === null ? null : Number(densityStitches),
    densityRows: densityRows === "" || densityRows === undefined || densityRows === null ? null : Number(densityRows),
    categories: categoryRecords,
    tags: tagRecords,
    instruments: instrumentRecords,
    yarnRanges: yarnRangeRecords,
    // Артикулы правит модератор, но связей ещё нет: описания в Pattern не
    // существует. Лежат в parsedData до одобрения, там же, куда их положил
    // скрапер, и резолвятся по normalizedKey — id к моменту одобрения может
    // указывать на слитую карточку (attachScrapedYarns).
    //
    // Ключ проставляем сами, из БД: клиент присылает то, что вернула
    // подсказка, а верить ему на слово в поле, по которому потом ищется
    // карточка, незачем.
    ...(Array.isArray(yarns)
      ? { yarns: await resolveYarnPayload(yarns), yarnMentions: prevParsedData.yarnMentions ?? [] }
      : {}),
  };

  const data: any = { parsedData };
  if (title !== undefined && String(title).trim()) data.title = normalizeQuotes(String(title).trim());
  if (url !== undefined && String(url).trim()) data.url = String(url).trim();

  const updated = await prisma.authorSyncItem.update({ where: { id: itemId }, data });

  res.json({ id: updated.id, title: updated.title, url: updated.url, parsedData: updated.parsedData });
};

async function downloadImage(url: string, filepath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

  const contentType = response.headers.get('content-type');
  if (!contentType?.startsWith('image/')) {
    throw new Error("Invalid format");
  }

  if (!response.body) throw new Error("No response body");
  const writer = fs.createWriteStream(filepath);
  // @ts-ignore (Node 18+ types for Readable.fromWeb)
  await pipeline(Readable.fromWeb(response.body), writer);
}

export const processSyncBatch = async (req: Request, res: Response) => {
  const { reportId } = req.params;
  const { items } = req.body;
  let successCount = 0;

  for (const payload of items) {
    const writtenFilepaths: string[] = [];
    try {
      // 1. Защита от SSRF (доверенные данные из БД)
      const dbItem = await prisma.authorSyncItem.findUnique({
        where: { id: payload.itemId },
        include: { report: { include: { author: true } } }
      });
      if (!dbItem || dbItem.reportId !== reportId) throw new Error("Invalid item");

      const parsedData = dbItem.parsedData as any;
      // Legacy fallback: items scraped before the images[] field existed
      // (and everything from the generic crawler, which still only ever
      // produces one imageUrl) only have imageUrl — see
      // pattern_images_plan.md риски №1/2.
      const sourceUrls: string[] = Array.isArray(parsedData?.images) && parsedData.images.length > 0
        ? parsedData.images
        : (parsedData?.imageUrl ? [parsedData.imageUrl] : []);
      if (sourceUrls.length === 0) throw new Error("No image URL");
      // Defensive clamp, not a hard rejection — this is scraped content the
      // admin already reviewed/could have trimmed via "Редактировать" before
      // approving, not a fresh request to validate (риск №7).
      const clampedUrls = sourceUrls.slice(0, MAX_PATTERN_IMAGES);

      // 2. Дедупликация слага ДО сохранения файлов
      let finalPatternSlug = generateSlug(dbItem.title);
      while (await prisma.pattern.findUnique({ where: { slug: finalPatternSlug } })) {
        finalPatternSlug = `${generateSlug(dbItem.title)}-${Date.now()}`;
      }

      const authorSlug = generateSlug(dbItem.report.author.name);

      // 3. Сетевой I/O через нативный fetch — все файлы галереи
      const images: string[] = [];
      for (let i = 0; i < clampedUrls.length; i++) {
        const sourceUrl = clampedUrls[i];
        const ext = path.extname(new URL(sourceUrl).pathname) || ".jpg";
        const filename = i === 0
          ? `${authorSlug}-${finalPatternSlug}${ext}`
          : `${authorSlug}-${finalPatternSlug}-${i + 1}${ext}`;
        const filepath = path.join(__dirname, "../../public/images/patterns", filename);

        await downloadImage(sourceUrl, filepath);
        writtenFilepaths.push(filepath);
        images.push(`/images/patterns/${filename}`);
      }

      // Thumbnail of the cover only (images[0]) — generated here, before the
      // DB transaction, since it's file I/O + CPU work that shouldn't hold a
      // transaction open. Best-effort: generateThumbnailUrl never throws,
      // returns null on failure, and the read side falls back to imageUrl.
      const thumbnailUrl = await generateThumbnailUrl(images[0]);

      // Толщину пряжи, если она не пришла со скрапера/от модератора,
      // выводим из метража артикулов — как в форме описания. Читаем БД
      // здесь, до транзакции.
      const hasOwnRanges = Array.isArray(parsedData.yarnRanges) && parsedData.yarnRanges.length > 0;
      const ownRangeIds: string[] = hasOwnRanges
        ? parsedData.yarnRanges.map((y: any) => y.id)
        : [];
      const derivedRangeIds = hasOwnRanges ? [] : await deriveYarnRangeIdsFromArticles(parsedData);
      const yarnRangeIdsToConnect = hasOwnRanges ? ownRangeIds : derivedRangeIds;

      // 4. Короткая БД-транзакция
      await prisma.$transaction(async (tx) => {
        const raceExists = await tx.pattern.findUnique({ where: { slug: finalPatternSlug } });
        if (raceExists) throw new Error("Slug race condition - retry needed");

        const createdPattern = await tx.pattern.create({
          data: {
            title: normalizeQuotes(dbItem.title),
            slug: finalPatternSlug,
            url: dbItem.url,
            images,
            imageUrl: deriveImageUrl(images),
            thumbnailUrl,
            // Not scraped yet (author_sync.py doesn't populate this key today)
            // — tolerates absence the same way the images[] legacy fallback
            // did before every site produced a gallery.
            details: parsedData.details ?? null,
            price: parsedData.price ?? null,
            oldPrice: parsedData.oldPrice ?? null,
            authorId: dbItem.report.authorId,
            isVisible: false, // В АРХИВ
            isFree: parsedData.isFree ?? false,
            isNew: parsedData.isNew ?? false,
            densityStitches: parsedData.densityStitches || null,
            densityRows: parsedData.densityRows || null,
            categories: { connect: (parsedData.categories || []).map((c: any) => ({ id: c.id })) },
            tags: { connect: (parsedData.tags || []).map((t: any) => ({ id: t.id })) },
            instruments: { connect: (parsedData.instruments || []).map((i: any) => ({ id: i.id })) },
            yarnRanges: { connect: yarnRangeIdsToConnect.map((id: string) => ({ id })) },
          }
        });

        await attachScrapedYarns(tx, createdPattern.id, parsedData);

        await tx.authorSyncItem.update({
          where: { id: dbItem.id },
          data: { status: "APPROVED" }
        });
      });
      successCount++;
    } catch (e: any) {
      console.error(`Failed to process item ${payload.itemId}:`, e);
      for (const filepath of writtenFilepaths) {
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      }
      return res.status(400).json({ error: e.message || "Ошибка обработки" });
    }
  }

  const remaining = await prisma.authorSyncItem.count({ where: { reportId, status: "PENDING" } });
  if (remaining === 0) {
    await prisma.authorSyncReport.update({ where: { id: reportId }, data: { status: "PROCESSED" } });
  }

  res.json({ processed: successCount, total: items.length });
};

export const rejectSyncItem = async (req: Request, res: Response) => {
  const { itemId } = req.params;
  const updatedItem = await prisma.authorSyncItem.update({ 
    where: { id: itemId }, 
    data: { status: "REJECTED" } 
  });
  
  const remaining = await prisma.authorSyncItem.count({ 
    where: { reportId: updatedItem.reportId, status: "PENDING" } 
  });
  
  if (remaining === 0) {
    await prisma.authorSyncReport.update({ 
      where: { id: updatedItem.reportId }, 
      data: { status: "PROCESSED" } 
    });
  }
  
  res.json({ success: true });
};

export const clearSyncReport = async (req: Request, res: Response) => {
  const { reportId } = req.params;
  
  await prisma.authorSyncItem.deleteMany({
    where: {
      reportId,
      status: { not: "REJECTED" }
    }
  });

  await prisma.authorSyncReport.update({
    where: { id: reportId },
    data: { status: "PROCESSED" }
  });

  res.json({ success: true });
};

export const getSyncStatus = async (req: Request, res: Response) => {
  res.json({ isRunning: isSyncing, authorId: syncingAuthorId });
};

export const checkPendingAuthors = async (req: Request, res: Response) => {
  const pendingReports = await prisma.authorSyncReport.findMany({
    where: { status: "PENDING" },
    include: { 
      author: { select: { name: true } },
      _count: { select: { items: { where: { status: "PENDING" } } } }
    }
  });
  
  // Get unique author names only for reports that actually have pending items
  const authorNames = Array.from(new Set(
    pendingReports
      .filter(r => r._count.items > 0)
      .map(r => r.author.name)
  ));
  res.json({ authors: authorNames });
};

const runSync = (res: Response, authorId: string | null) => {
  if (isSyncing) {
    return res.status(400).json({ error: "Sync already in progress" });
  }

  isSyncing = true;
  syncingAuthorId = authorId;

  const scriptPath = path.resolve(__dirname, "../../src/scripts/author_sync.py");
  const args = authorId ? [scriptPath, authorId] : [scriptPath];
  const pyProcess = spawn("python3", args, {
    env: process.env // pass DATABASE_URL and other env vars
  });

  pyProcess.stdout.on('data', (data) => {
    console.log(`[Sync] ${data.toString().trim()}`);
  });
  pyProcess.stderr.on('data', (data) => {
    console.error(`[Sync Error] ${data.toString().trim()}`);
  });

  pyProcess.on('error', (err) => {
    isSyncing = false;
    syncingAuthorId = null;
    console.error(`[Sync] Failed to start subprocess:`, err);
  });

  pyProcess.on('close', (code) => {
    isSyncing = false;
    syncingAuthorId = null;
    console.log(`[Sync] Process exited with code ${code}`);
  });

  res.json({ success: true });
};

export const startSync = async (req: Request, res: Response) => {
  runSync(res, null);
};

export const startAuthorSync = async (req: Request, res: Response) => {
  const { id } = req.params;
  const author = await prisma.author.findUnique({ where: { id }, select: { site: true } });
  if (!author) {
    return res.status(404).json({ error: "Автор не найден" });
  }
  if (!author.site || SOCIAL_SITE_PATTERN.test(author.site)) {
    return res.status(400).json({ error: "У автора не указан сайт для проверки новинок" });
  }
  runSync(res, id);
};
