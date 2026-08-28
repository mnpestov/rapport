import { Request, Response } from "express";
import { DraftStatus } from "@prisma/client";
import { prisma } from "../prismaClient";
import { validateImages, validateNewImageOrigins, diffImages, deriveImageUrl } from "../utils/patternImages";
import { generateThumbnailUrl } from "../utils/imagePipeline";
import { normalizeQuotes } from "../utils/adminShared";

// ---------------------------------------------------------------------------
// Rate limiter — in-memory, per userId.
// Limits draft creation to 10 per hour to protect the moderation queue.
// Note: resets on process restart and does not sync across multiple processes.
// ---------------------------------------------------------------------------
class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  isAllowed(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (prev.length >= this.limit) return false;
    prev.push(now);
    this.hits.set(key, prev);
    return true;
  }
}

const draftCreateLimiter = new RateLimiter(10, 60 * 60 * 1000); // 10 per hour

// ---------------------------------------------------------------------------
// Helper — resolve the authorId linked to the current user.
// Throws a typed error if the link is missing.
// ---------------------------------------------------------------------------
async function resolveAuthorId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { authorId: true },
  });
  if (!user?.authorId) {
    const err = new Error("NO_AUTHOR_LINKED") as any;
    err.status = 403;
    throw err;
  }
  return user.authorId;
}

function handleAuthorError(error: any, res: Response, context: string): void {
  if (error.message === "NO_AUTHOR_LINKED") {
    res.status(403).json({ error: "Your account is not linked to an author profile" });
    return;
  }
  console.error(`[Author] ${context} failed:`, error);
  res.status(500).json({ error: "Internal server error" });
}

// ---------------------------------------------------------------------------
// GET /author/me
// ---------------------------------------------------------------------------
export const getAuthorMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const authorId = await resolveAuthorId(req.user!.userId);

    const author = await prisma.author.findUnique({
      where: { id: authorId },
      select: { id: true, name: true },
    });

    res.json({ author });
  } catch (error: any) {
    handleAuthorError(error, res, "getAuthorMe");
  }
};

// ---------------------------------------------------------------------------
// GET /author/patterns
// Combined list: own Drafts (any status, open only) + own published Patterns.
// ---------------------------------------------------------------------------
export const getAuthorPatterns = async (req: Request, res: Response): Promise<void> => {
  try {
    const authorId = await resolveAuthorId(req.user!.userId);

    const [drafts, patterns] = await Promise.all([
      prisma.draft.findMany({
        where: { authorId, closedAt: null },
        orderBy: { updatedAt: "desc" },
        include: {
          tags: { select: { id: true, name: true } },
          categories: { select: { id: true, name: true } },
          instruments: { select: { id: true, name: true } },
          yarnRanges: { select: { id: true, label: true } },
          pattern: { select: { id: true, title: true } },
        },
      }),
      prisma.pattern.findMany({
        where: { authorId },
        orderBy: { updatedAt: "desc" },
        include: {
          tags: { select: { id: true, name: true } },
          categories: { select: { id: true, name: true } },
          instruments: { select: { id: true, name: true } },
          yarnRanges: { select: { id: true, label: true } },
        },
      }),
    ]);

    // Mark items by type so the frontend can apply different actions
    const draftItems = drafts.map((d) => ({ ...d, thumbnailUrl: d.thumbnailUrl || d.imageUrl, _type: "draft" as const }));
    const patternItems = patterns.map((p) => ({ ...p, thumbnailUrl: p.thumbnailUrl || p.imageUrl, _type: "pattern" as const }));

    res.json({ drafts: draftItems, patterns: patternItems });
  } catch (error: any) {
    handleAuthorError(error, res, "getAuthorPatterns");
  }
};

// ---------------------------------------------------------------------------
// POST /author/drafts — create a new draft for a brand-new pattern
// ---------------------------------------------------------------------------
export const createDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    if (!draftCreateLimiter.isAllowed(userId)) {
      res.status(429).json({ error: "Too many drafts created. Try again later." });
      return;
    }

    const authorId = await resolveAuthorId(userId);

    const { title, url, images, details, price, oldPrice, isFree, isNew, tags, categories, instruments, yarnRangeIds, densityStitches, densityRows } = req.body;

    if (!title || !url) {
      res.status(400).json({ error: "title, url, and images are required" });
      return;
    }

    const imagesValidation = validateImages(images);
    if (!imagesValidation.ok) {
      res.status(400).json({ error: imagesValidation.error });
      return;
    }
    const originCheck = validateNewImageOrigins(imagesValidation.images);
    if (!originCheck.ok) {
      res.status(400).json({ error: originCheck.error });
      return;
    }

    const draft = await prisma.draft.create({
      data: {
        authorId,
        title: normalizeQuotes(title),
        url,
        images: imagesValidation.images,
        imageUrl: deriveImageUrl(imagesValidation.images),
        thumbnailUrl: await generateThumbnailUrl(imagesValidation.images[0]),
        details: details ?? null,
        price: price === "" || price === undefined || price === null ? null : Number(price),
        oldPrice: oldPrice === "" || oldPrice === undefined || oldPrice === null ? null : Number(oldPrice),
        isFree: isFree ?? false,
        isNew: isNew ?? false,
        densityStitches: densityStitches === "" || densityStitches === undefined || densityStitches === null ? null : Number(densityStitches),
        densityRows: densityRows === "" || densityRows === undefined || densityRows === null ? null : Number(densityRows),
        tags: Array.isArray(tags) && tags.length > 0
          ? { connect: tags.map((id: string) => ({ id })) }
          : undefined,
        categories: Array.isArray(categories) && categories.length > 0
          ? { connect: categories.map((id: string) => ({ id })) }
          : undefined,
        instruments: Array.isArray(instruments) && instruments.length > 0
          ? { connect: instruments.map((id: string) => ({ id })) }
          : undefined,
        yarnRanges: Array.isArray(yarnRangeIds) && yarnRangeIds.length > 0
          ? { connect: yarnRangeIds.map((id: string) => ({ id })) }
          : undefined,
      },
      include: {
        tags: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
        instruments: { select: { id: true, name: true } },
        yarnRanges: { select: { id: true, label: true } },
        pattern: { select: { id: true, title: true } },
      },
    });

    res.status(201).json({ ...draft, _type: "draft" as const });
  } catch (error: any) {
    handleAuthorError(error, res, "createDraft");
  }
};

// ---------------------------------------------------------------------------
// POST /author/patterns/:id/edit — create an edit draft for a published pattern
// ---------------------------------------------------------------------------
export const createEditDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    if (!draftCreateLimiter.isAllowed(userId)) {
      res.status(429).json({ error: "Too many drafts created. Try again later." });
      return;
    }

    const authorId = await resolveAuthorId(userId);
    const { id: patternId } = req.params;

    const pattern = await prisma.pattern.findUnique({
      where: { id: patternId },
      include: {
        tags: { select: { id: true } },
        categories: { select: { id: true } },
        instruments: { select: { id: true } },
        yarnRanges: { select: { id: true } },
      },
    });

    if (!pattern) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    // Ownership check
    if (pattern.authorId !== authorId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // One active edit draft per pattern at a time (enforced in app code;
    // the partial unique index in the DB provides the DB-level guarantee)
    const existingDraft = await prisma.draft.findFirst({
      where: { patternId, closedAt: null },
    });
    if (existingDraft) {
      res.status(409).json({
        error: "An active draft already exists for this pattern",
        draftId: existingDraft.id,
      });
      return;
    }

    const draft = await prisma.draft.create({
      data: {
        patternId,
        authorId,
        title: pattern.title,
        url: pattern.url,
        images: pattern.images,
        imageUrl: pattern.imageUrl,
        // Cover unchanged at draft-creation time (just a snapshot of the
        // existing pattern) — copy as-is, no regeneration needed, unlike
        // the other write points where images[0] can actually change.
        thumbnailUrl: pattern.thumbnailUrl,
        details: pattern.details,
        price: pattern.price,
        oldPrice: pattern.oldPrice,
        isFree: pattern.isFree,
        isNew: pattern.isNew,
        densityStitches: pattern.densityStitches,
        densityRows: pattern.densityRows,
        tags: pattern.tags.length > 0
          ? { connect: pattern.tags.map((t) => ({ id: t.id })) }
          : undefined,
        categories: pattern.categories.length > 0
          ? { connect: pattern.categories.map((c) => ({ id: c.id })) }
          : undefined,
        instruments: pattern.instruments.length > 0
          ? { connect: pattern.instruments.map((i) => ({ id: i.id })) }
          : undefined,
        yarnRanges: pattern.yarnRanges.length > 0
          ? { connect: pattern.yarnRanges.map((y) => ({ id: y.id })) }
          : undefined,
      },
      include: {
        tags: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
        instruments: { select: { id: true, name: true } },
        yarnRanges: { select: { id: true, label: true } },
        pattern: { select: { id: true, title: true } },
      },
    });

    res.status(201).json({ ...draft, _type: "draft" as const });
  } catch (error: any) {
    handleAuthorError(error, res, "createEditDraft");
  }
};

// ---------------------------------------------------------------------------
// PATCH /author/drafts/:id — update draft content
// ---------------------------------------------------------------------------
export const updateDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const authorId = await resolveAuthorId(req.user!.userId);
    const { id } = req.params;

    const draft = await prisma.draft.findUnique({ where: { id } });

    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }

    // IDOR check
    if (draft.authorId !== authorId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (draft.closedAt) {
      res.status(400).json({ error: "Draft is closed" });
      return;
    }

    if (draft.status === DraftStatus.PENDING) {
      res.status(400).json({ error: "Cannot edit a draft that is pending review" });
      return;
    }

    const { title, url, images, details, price, oldPrice, isFree, isNew, tags, categories, instruments, yarnRangeIds, densityStitches, densityRows } = req.body;

    const data: any = {};
    if (title !== undefined) data.title = normalizeQuotes(title);
    if (url !== undefined) data.url = url;
    if (details !== undefined) data.details = details;

    let imagesDiff: { added: string[]; removed: string[] } | null = null;
    if (images !== undefined) {
      const imagesValidation = validateImages(images);
      if (!imagesValidation.ok) {
        res.status(400).json({ error: imagesValidation.error });
        return;
      }
      imagesDiff = diffImages(draft.images, imagesValidation.images);
      const originCheck = validateNewImageOrigins(imagesDiff.added);
      if (!originCheck.ok) {
        res.status(400).json({ error: originCheck.error });
        return;
      }
      data.images = imagesValidation.images;
      data.imageUrl = deriveImageUrl(imagesValidation.images);
      data.thumbnailUrl = await generateThumbnailUrl(imagesValidation.images[0]);
    }

    if (isFree !== undefined) data.isFree = isFree;
    if (isNew !== undefined) data.isNew = isNew;
    if (densityStitches !== undefined) data.densityStitches = densityStitches === "" || densityStitches === null ? null : Number(densityStitches);
    if (densityRows !== undefined) data.densityRows = densityRows === "" || densityRows === null ? null : Number(densityRows);
    if (price !== undefined) data.price = price === "" || price === null ? null : Number(price);
    if (oldPrice !== undefined) data.oldPrice = oldPrice === "" || oldPrice === null ? null : Number(oldPrice);

    if (Array.isArray(tags)) {
      data.tags = { set: [], connect: tags.map((id: string) => ({ id })) };
    }
    if (Array.isArray(categories)) {
      data.categories = { set: [], connect: categories.map((id: string) => ({ id })) };
    }
    if (Array.isArray(instruments)) {
      data.instruments = { set: [], connect: instruments.map((id: string) => ({ id })) };
    }
    if (Array.isArray(yarnRangeIds)) {
      data.yarnRanges = { set: yarnRangeIds.map((id: string) => ({ id })) };
    }

    const updated = await prisma.draft.update({
      where: { id },
      data,
      include: {
        tags: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
        instruments: { select: { id: true, name: true } },
        yarnRanges: { select: { id: true, label: true } },
        pattern: { select: { id: true, title: true } },
      },
    });

    res.json({ ...updated, _type: "draft" as const });
  } catch (error: any) {
    handleAuthorError(error, res, "updateDraft");
  }
};

// ---------------------------------------------------------------------------
// DELETE /author/drafts/:id — permanently delete own draft
// ---------------------------------------------------------------------------
export const deleteDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const authorId = await resolveAuthorId(req.user!.userId);
    const { id } = req.params;

    const draft = await prisma.draft.findUnique({ where: { id } });

    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }

    // IDOR check
    if (draft.authorId !== authorId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (draft.status === DraftStatus.PENDING) {
      res.status(400).json({ error: "Cannot delete a draft that is pending review" });
      return;
    }

    await prisma.draft.delete({ where: { id } });

    res.json({ success: true });
  } catch (error: any) {
    handleAuthorError(error, res, "deleteDraft");
  }
};

// ---------------------------------------------------------------------------
// POST /author/drafts/:id/submit — DRAFT or REJECTED → PENDING
// ---------------------------------------------------------------------------
export const submitDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const authorId = await resolveAuthorId(req.user!.userId);
    const { id } = req.params;

    const draft = await prisma.draft.findUnique({ where: { id } });

    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }

    // IDOR check
    if (draft.authorId !== authorId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (draft.closedAt) {
      res.status(400).json({ error: "Draft is closed" });
      return;
    }

    if (draft.status !== DraftStatus.DRAFT && draft.status !== DraftStatus.REJECTED) {
      res.status(400).json({ error: "Only DRAFT or REJECTED drafts can be submitted" });
      return;
    }

    await prisma.draft.update({
      where: { id },
      data: { status: DraftStatus.PENDING, moderationComment: null },
    });

    res.json({ success: true });
  } catch (error: any) {
    handleAuthorError(error, res, "submitDraft");
  }
};

// ---------------------------------------------------------------------------
// GET /author/drafts/:id — single draft (own only)
// ---------------------------------------------------------------------------
export const getDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const authorId = await resolveAuthorId(req.user!.userId);
    const { id } = req.params;

    const draft = await prisma.draft.findUnique({
      where: { id },
      include: {
        tags: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
        instruments: { select: { id: true, name: true } },
        pattern: { select: { id: true, title: true } },
      },
    });

    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }

    if (draft.authorId !== authorId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json({ ...draft, thumbnailUrl: draft.thumbnailUrl || draft.imageUrl });
  } catch (error: any) {
    handleAuthorError(error, res, "getDraft");
  }
};

// ---------------------------------------------------------------------------
// POST /author/patterns/:id/archive — hide own published pattern (isVisible=false)
// ---------------------------------------------------------------------------
export const archivePattern = async (req: Request, res: Response): Promise<void> => {
  try {
    const authorId = await resolveAuthorId(req.user!.userId);
    const { id } = req.params;

    const pattern = await prisma.pattern.findUnique({ where: { id } });

    if (!pattern) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    // IDOR check
    if (pattern.authorId !== authorId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await prisma.pattern.update({ where: { id }, data: { isVisible: false } });

    res.json({ success: true });
  } catch (error: any) {
    handleAuthorError(error, res, "archivePattern");
  }
};
