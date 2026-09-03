import { Request, Response } from "express";
import { DraftStatus } from "@prisma/client";
import { prisma } from "../prismaClient";
import { generateSlug } from "../utils/slug";
import { deriveImageUrl } from "../utils/patternImages";
import { generateThumbnailUrl } from "../utils/imagePipeline";
import { normalizeUrl } from "../utils/adminShared";
import { notifyPriceChange } from "../services/priceAlertNotifier";

// ---------------------------------------------------------------------------
// Moderation, user-author linking
// ---------------------------------------------------------------------------

// GET /admin/drafts?status=PENDING
export const getDraftsList = async (req: Request, res: Response): Promise<void> => {
  try {
    const statusParam = (req.query.status as string)?.toUpperCase();
    const where: any = {};
    if (statusParam) where.status = statusParam;
    // By default only show open drafts
    if (!("closedAt" in req.query)) where.closedAt = null;

    const drafts = await prisma.draft.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        author: { select: { id: true, name: true } },
        pattern: { select: { id: true, title: true } },
        tags: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
        instruments: { select: { id: true, name: true } },
        yarnRanges: { select: { id: true, label: true } },
        // Author's manual YarnPicker choices (DraftYarn) — same shape
        // ({id, name}) ModerationCard already expects for scraper-found
        // yarns, so no frontend change needed to display these.
        yarns: { select: { yarn: { select: { id: true, name: true } } } },
      },
    });

    res.json(
      drafts.map((d) => ({
        ...d,
        thumbnailUrl: d.thumbnailUrl || d.imageUrl,
        yarns: d.yarns.map((link) => link.yarn),
      }))
    );
  } catch (error) {
    console.error("[Admin] getDraftsList failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/drafts/:id
export const getDraftById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const draft = await prisma.draft.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true } },
        pattern: {
          include: {
            tags: { select: { id: true, name: true } },
            categories: { select: { id: true, name: true } },
            instruments: { select: { id: true, name: true } },
          },
        },
        tags: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
        instruments: { select: { id: true, name: true } },
      },
    });

    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }

    res.json({ ...draft, thumbnailUrl: draft.thumbnailUrl || draft.imageUrl });
  } catch (error) {
    console.error("[Admin] getDraftById failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/drafts/:id/approve
export const approveDraft = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const adminId = req.user!.userId;

  // Для уведомления подписчиков PRICE_ALERT: собираем данные внутри
  // транзакции, шлём после её успешного коммита (вариант B). Только для
  // правки существующего описания — у нового подписчиков нет.
  let priceEvent: {
    patternId: string;
    title: string;
    oldPrice: number | null;
    oldIsFree: boolean;
    newPrice: number | null;
    newIsFree: boolean;
  } | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      const draft = await tx.draft.findUnique({
        where: { id },
        include: {
          tags: { select: { id: true } },
          categories: { select: { id: true } },
          instruments: { select: { id: true } },
          yarnRanges: { select: { id: true } },
          yarns: { select: { yarnId: true } },
        },
      });

      if (!draft) throw Object.assign(new Error("NOT_FOUND"), { status: 404 });
      if (draft.closedAt) throw Object.assign(new Error("ALREADY_CLOSED"), { status: 409 });
      if (draft.status !== DraftStatus.PENDING)
        throw Object.assign(new Error("NOT_PENDING"), { status: 409 });
      // Approval always publishes (isVisible: true below, both branches) —
      // an empty instrument list here would otherwise sail straight through
      // with no gate at all, unlike every other publish path.
      if (draft.instruments.length === 0)
        throw Object.assign(new Error("NO_INSTRUMENTS"), { status: 400 });

      const tagConnect = draft.tags.map((t) => ({ id: t.id }));
      const catConnect = draft.categories.map((c) => ({ id: c.id }));
      const instConnect = draft.instruments.map((i) => ({ id: i.id }));
      const yarnRangeConnect = draft.yarnRanges.map((y) => ({ id: y.id }));
      // Same source (draft.images[0]) for both branches below — computed
      // once. File I/O + resize inside the transaction is not ideal, but
      // draft.images isn't known before it (the draft itself is fetched
      // inside, guarded by the PENDING/closedAt checks above) — acceptable
      // here since approveDraft is a low-frequency, one-at-a-time admin
      // action, not a hot path.
      const thumbnailUrl = await generateThumbnailUrl(draft.images[0]);

      let publishedPatternId: string;

      if (draft.patternId === null) {
        // New pattern — generate slug + check URL uniqueness
        let slug = generateSlug(draft.title);
        const slugExists = await tx.pattern.findUnique({ where: { slug } });
        if (slugExists) slug = `${slug}-${Date.now()}`;

        const normUrl = normalizeUrl(draft.url);
        const urlExists = await tx.pattern.findFirst({ where: { url: normUrl } });
        if (urlExists) throw Object.assign(new Error("URL_DUPLICATE"), { status: 409 });

        const created = await tx.pattern.create({
          data: {
            slug,
            title: draft.title,
            url: normUrl,
            images: draft.images,
            imageUrl: deriveImageUrl(draft.images),
            thumbnailUrl,
            details: draft.details,
            price: draft.price,
            oldPrice: draft.oldPrice,
            isFree: draft.isFree,
            isNew: draft.isNew,
            isVisible: true,
            publishedAt: new Date(),
            authorId: draft.authorId,
            densityStitches: draft.densityStitches,
            densityRows: draft.densityRows,
            tags: { connect: tagConnect },
            categories: { connect: catConnect },
            instruments: { connect: instConnect },
            yarnRanges: { connect: yarnRangeConnect },
          },
        });
        publishedPatternId = created.id;
      } else {
        // Edit existing pattern
        const current = await tx.pattern.findUnique({
          where: { id: draft.patternId },
          select: { price: true, isFree: true },
        });

        await tx.pattern.update({
          where: { id: draft.patternId },
          data: {
            title: draft.title,
            url: normalizeUrl(draft.url),
            images: draft.images,
            imageUrl: deriveImageUrl(draft.images),
            thumbnailUrl,
            details: draft.details,
            price: draft.price,
            oldPrice: draft.oldPrice,
            isFree: draft.isFree,
            isNew: draft.isNew,
            densityStitches: draft.densityStitches,
            densityRows: draft.densityRows,
            tags: { set: [], connect: tagConnect },
            categories: { set: [], connect: catConnect },
            instruments: { set: [], connect: instConnect },
            yarnRanges: { set: [], connect: yarnRangeConnect },
          },
        });
        publishedPatternId = draft.patternId;

        priceEvent = {
          patternId: draft.patternId,
          title: draft.title,
          oldPrice: current?.price != null ? Number(current.price) : null,
          oldIsFree: current?.isFree ?? false,
          newPrice: draft.price != null ? Number(draft.price) : null,
          newIsFree: draft.isFree,
        };
      }

      // DraftYarn (author's manual YarnPicker choices) isn't an implicit
      // M:N relation like tags/categories/instruments/yarnRanges above — it
      // has its own model (like PatternYarn), so it needs its own
      // create/replace step instead of a `connect` inside the writes above.
      // ADMIN source/MANUAL rule matches what setPatternYarns already
      // records for a moderator's manual pick — this is the same kind of
      // action, just made by the author instead.
      await tx.patternYarn.deleteMany({ where: { patternId: publishedPatternId, source: "ADMIN" } });
      if (draft.yarns.length > 0) {
        await tx.patternYarn.createMany({
          data: draft.yarns.map((y) => ({
            patternId: publishedPatternId,
            yarnId: y.yarnId,
            source: "ADMIN",
            matchRule: "MANUAL",
          })),
          skipDuplicates: true,
        });
      }

      // Close draft as audit log — not hard-deleted
      await tx.draft.update({
        where: { id },
        data: {
          status: DraftStatus.APPROVED,
          closedAt: new Date(),
          closedById: adminId,
        },
      });
    });

    // После успешного коммита — рассылка подписчикам (fire-and-forget,
    // не влияет на ответ и не откатывает одобрение).
    if (priceEvent) void notifyPriceChange(priceEvent);

    res.json({ success: true });
  } catch (error: any) {
    if (error.status === 404) { res.status(404).json({ error: "Draft not found" }); return; }
    if (error.message === "ALREADY_CLOSED") { res.status(409).json({ error: "Draft is already closed" }); return; }
    if (error.message === "NOT_PENDING") { res.status(409).json({ error: "Only PENDING drafts can be approved" }); return; }
    if (error.message === "NO_INSTRUMENTS") { res.status(400).json({ error: "Cannot publish a pattern with no instruments" }); return; }
    if (error.message === "URL_DUPLICATE") { res.status(409).json({ error: "URL already exists in published patterns" }); return; }
    console.error("[Admin] approveDraft failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/drafts/:id/reject
export const rejectDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { moderationComment } = req.body;
    const adminId = req.user!.userId;

    const draft = await prisma.draft.findUnique({ where: { id } });
    if (!draft) { res.status(404).json({ error: "Draft not found" }); return; }
    if (draft.closedAt) { res.status(409).json({ error: "Draft is already closed" }); return; }
    if (draft.status !== DraftStatus.PENDING) {
      res.status(409).json({ error: "Only PENDING drafts can be rejected" });
      return;
    }

    await prisma.draft.update({
      where: { id },
      data: {
        status: DraftStatus.REJECTED,
        moderationComment: moderationComment ?? null,
        closedById: adminId,
        // closedAt intentionally not set — rejected draft stays open for author to fix
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] rejectDraft failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/users/:id/link-author
export const linkAuthor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.params;
    const { authorId } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    if (authorId !== null && authorId !== undefined) {
      const author = await prisma.author.findUnique({ where: { id: authorId } });
      if (!author) { res.status(404).json({ error: "Author not found" }); return; }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { authorId: authorId ?? null },
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error.code === "P2002") {
      res.status(409).json({ error: "This author is already linked to another user" });
      return;
    }
    console.error("[Admin] linkAuthor failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
