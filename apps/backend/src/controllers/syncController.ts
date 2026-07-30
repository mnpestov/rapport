import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { generateSlug } from "../utils/slug";
import path from "path";
import fs from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { spawn } from "child_process";

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

export const processSyncBatch = async (req: Request, res: Response) => {
  const { reportId } = req.params;
  const { items } = req.body; 
  let successCount = 0;
  
  for (const payload of items) {
    let filepath = "";
    try {
      // 1. Защита от SSRF (доверенные данные из БД)
      const dbItem = await prisma.authorSyncItem.findUnique({
        where: { id: payload.itemId },
        include: { report: { include: { author: true } } }
      });
      if (!dbItem || dbItem.reportId !== reportId) throw new Error("Invalid item");

      const parsedData = dbItem.parsedData as any;
      const imageUrl = parsedData?.imageUrl;
      if (!imageUrl) throw new Error("No image URL");

      // 2. Дедупликация слага ДО сохранения файла
      let finalPatternSlug = generateSlug(dbItem.title);
      while (await prisma.pattern.findUnique({ where: { slug: finalPatternSlug } })) {
        finalPatternSlug = `${generateSlug(dbItem.title)}-${Date.now()}`;
      }

      const authorSlug = generateSlug(dbItem.report.author.name);
      const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
      const filename = `${authorSlug}-${finalPatternSlug}${ext}`;
      filepath = path.join(__dirname, "../../public/images/patterns", filename);
      
      // 3. Сетевой I/O через нативный fetch
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const contentType = response.headers.get('content-type');
      if (!contentType?.startsWith('image/')) {
        throw new Error("Invalid format");
      }
      
      if (!response.body) throw new Error("No response body");
      const writer = fs.createWriteStream(filepath);
      // @ts-ignore (Node 18+ types for Readable.fromWeb)
      await pipeline(Readable.fromWeb(response.body), writer);

      // 4. Короткая БД-транзакция
      await prisma.$transaction(async (tx) => {
        const raceExists = await tx.pattern.findUnique({ where: { slug: finalPatternSlug } });
        if (raceExists) throw new Error("Slug race condition - retry needed");

        await tx.pattern.create({
          data: {
            title: dbItem.title,
            slug: finalPatternSlug,
            url: dbItem.url,
            imageUrl: `/images/patterns/${filename}`,
            authorId: dbItem.report.authorId,
            isVisible: false, // В АРХИВ
            isFree: false,
            densityStitches: parsedData.densityStitches || null,
            densityRows: parsedData.densityRows || null,
            categories: { connect: (parsedData.categories || []).map((c: any) => ({ id: c.id })) },
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
      if (filepath && fs.existsSync(filepath)) fs.unlinkSync(filepath);
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
