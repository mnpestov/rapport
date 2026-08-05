import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { generateSlug } from "../utils/slug";
import path from "path";
import fs from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { spawn } from "child_process";
import { syncCategories, syncTags, syncInstruments } from "./adminController";
import { validateImages, validateNewImageOrigins, diffImages, deriveImageUrl, MAX_PATTERN_IMAGES } from "../utils/patternImages";

let isSyncing = false;
// Author.id currently being synced, or null when a full (all-authors) sync
// is running. Only one sync — full or single-author — runs at a time; they
// share isSyncing as a lock since main() does a global URL-dedup prefetch
// and writes via a single DB connection regardless of scope.
let syncingAuthorId: string | null = null;
const SOCIAL_SITE_PATTERN = /t\.me|vk\.com|instagram\.com/i;

export const getPendingReports = async (req: Request, res: Response) => {
  // Выборка только PENDING отчетов для бейджа
  const reports = await prisma.authorSyncReport.findMany({
    where: { status: "PENDING" },
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
  res.json(report);
};

// PATCH /admin/sync-items/:itemId — persists admin edits to a pending novelty
// item BEFORE it's approved (processSyncBatch always re-reads title/url/parsedData
// fresh from the DB row, so edits saved here take effect on the next approve).
export const updateSyncItem = async (req: Request, res: Response) => {
  const { itemId } = req.params;
  const { title, url, images, isFree, isNew, densityStitches, densityRows, categories, tags, instruments, yarnRangeIds } = req.body;

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
    isFree: !!isFree,
    isNew: !!isNew,
    densityStitches: densityStitches === "" || densityStitches === undefined || densityStitches === null ? null : Number(densityStitches),
    densityRows: densityRows === "" || densityRows === undefined || densityRows === null ? null : Number(densityRows),
    categories: categoryRecords,
    tags: tagRecords,
    instruments: instrumentRecords,
    yarnRanges: yarnRangeRecords,
  };

  const data: any = { parsedData };
  if (title !== undefined && String(title).trim()) data.title = String(title).trim();
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

      // 4. Короткая БД-транзакция
      await prisma.$transaction(async (tx) => {
        const raceExists = await tx.pattern.findUnique({ where: { slug: finalPatternSlug } });
        if (raceExists) throw new Error("Slug race condition - retry needed");

        await tx.pattern.create({
          data: {
            title: dbItem.title,
            slug: finalPatternSlug,
            url: dbItem.url,
            images,
            imageUrl: deriveImageUrl(images),
            authorId: dbItem.report.authorId,
            isVisible: false, // В АРХИВ
            isFree: parsedData.isFree ?? false,
            isNew: parsedData.isNew ?? false,
            densityStitches: parsedData.densityStitches || null,
            densityRows: parsedData.densityRows || null,
            categories: { connect: (parsedData.categories || []).map((c: any) => ({ id: c.id })) },
            tags: { connect: (parsedData.tags || []).map((t: any) => ({ id: t.id })) },
            instruments: { connect: (parsedData.instruments || []).map((i: any) => ({ id: i.id })) },
            yarnRanges: { connect: (parsedData.yarnRanges || []).map((y: any) => ({ id: y.id })) },
          }
        });

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
