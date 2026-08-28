import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import fs from "fs";
import path from "path";
import { generateSlug } from "../utils/slug";
import { validateImages, validateNewImageOrigins, diffImages, deriveImageUrl, isOwnUpload } from "../utils/patternImages";
import { generateThumbnailUrl } from "../utils/imagePipeline";
import { normalizeUrl, normalizeQuotes, syncAuthor, syncTags, syncCategories, syncInstruments } from "../utils/adminShared";

/**
 * Admin patterns CRUD. All handlers are reached only through requireAuth + requireAdmin.
 */

// GET /admin/patterns
export const getPatternsList = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string; // 'active' | 'archive' | 'all'
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status === "active") where.isVisible = true;
    else if (status === "archive") where.isVisible = false;

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { url: { contains: search, mode: "insensitive" } },
        { author: { name: { contains: search, mode: "insensitive" } } },
        { categories: { some: { name: { contains: search, mode: "insensitive" } } } },
        { tags: { some: { name: { contains: search, mode: "insensitive" } } } },
        { instruments: { some: { name: { contains: search, mode: "insensitive" } } } }
      ];
    }

    const [items, total] = await Promise.all([
      prisma.pattern.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          author: true,
          categories: true,
          tags: true,
          instruments: true,
          yarnRanges: true,
        },
      }),
      prisma.pattern.count({ where }),
    ]);

    // Map to DTO for the table
    const mappedItems = items.map((pattern) => ({
      id: pattern.id,
      title: pattern.title,
      createdAt: pattern.createdAt.toISOString(),
      category: pattern.categories.map((c) => c.name).join(", "),
      characteristics: pattern.tags.map((t) => t.name).join(", "),
      url: pattern.url,
      author: pattern.author.name,
      instrument: pattern.instruments.map((i) => i.name).join(", "),
      // 41×51px table row preview — small enough that thumbnailUrl belongs
      // here, not imageUrl (that stays full quality for the detail page's
      // non-premium fallback, see image_pipeline_plan.md).
      preview: pattern.thumbnailUrl || pattern.imageUrl,
      isVisible: pattern.isVisible,
      isNew: pattern.isNew,
      thickness: pattern.yarnRanges.map((y) => y.label).join(", ") || undefined,
      density: pattern.densityStitches != null && pattern.densityRows != null
        ? `${pattern.densityStitches} х ${pattern.densityRows}`
        : undefined,
    }));

    res.json({
      items: mappedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("[Admin] getPatternsList failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};


// GET /admin/patterns/:id
export const getPatternById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const pattern = await prisma.pattern.findUnique({
      where: { id },
      include: {
        author: true,
        categories: true,
        tags: true,
        instruments: true,
        yarnRanges: true,
      },
    });

    if (!pattern) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    // Map to DTO for the edit form
    const dto = {
      id: pattern.id,
      slug: pattern.slug,
      title: pattern.title,
      url: pattern.url,
      imageUrl: pattern.imageUrl,
      thumbnailUrl: pattern.thumbnailUrl || pattern.imageUrl,
      images: pattern.images,
      details: pattern.details,
      price: pattern.price,
      oldPrice: pattern.oldPrice,
      isFree: pattern.isFree,
      isNew: pattern.isNew,
      isVisible: pattern.isVisible,
      densityStitches: pattern.densityStitches,
      densityRows: pattern.densityRows,
      createdAt: pattern.createdAt,
      updatedAt: pattern.updatedAt,
      author: {
        id: pattern.author.id,
        name: pattern.author.name,
      },
      categories: pattern.categories.map((c) => ({ id: c.id, name: c.name })),
      tags: pattern.tags.map((t) => ({ id: t.id, name: t.name })),
      instruments: pattern.instruments.map((i) => ({ id: i.id, name: i.name })),
      yarnRanges: pattern.yarnRanges.map((y) => ({ id: y.id, label: y.label })),
    };

    res.json(dto);
  } catch (error) {
    console.error("[Admin] getPatternById failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// PATCH /admin/patterns/:id
export const updatePattern = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, url, images, details, price, oldPrice, isFree, isNew, authorId, authorName, isVisible, categories, tags, instruments, yarnRangeIds, densityStitches, densityRows } = req.body;

    const existing = await prisma.pattern.findUnique({
      where: { id },
      include: { instruments: { select: { id: true } } },
    });
    if (!existing) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    let imagesDiff: { added: string[]; removed: string[] } | null = null;
    let validatedImages: string[] | undefined;
    if (images !== undefined) {
      const validation = validateImages(images);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error });
        return;
      }
      validatedImages = validation.images;
      imagesDiff = diffImages(existing.images, validatedImages);
      const originCheck = validateNewImageOrigins(imagesDiff.added);
      if (!originCheck.ok) {
        res.status(400).json({ error: originCheck.error });
        return;
      }
    }

    // Block admin edits while an author's draft is under review — the draft
    // approve transaction would silently overwrite any changes made here.
    const activeDraft = await prisma.draft.findFirst({
      where: { patternId: id, closedAt: null },
    });
    if (activeDraft) {
      res.status(409).json({
        error: "Pattern has an active author draft under review. Approve or reject it first.",
        draftId: activeDraft.id,
        draftStatus: activeDraft.status,
      });
      return;
    }

    // Can't publish (or stay published) with no instrument set — check
    // against the incoming instruments array when this request touches it,
    // else fall back to what's already attached (see `existing`'s include
    // above) — a bare { isVisible: true } call (single/bulk "Опубликовать"
    // buttons, no instruments in the body) must still be gated on the
    // pattern's CURRENT instruments, not skip the check entirely.
    const willBeVisible = isVisible !== undefined ? isVisible : existing.isVisible;
    const finalInstrumentsCount = Array.isArray(instruments) ? instruments.length : existing.instruments.length;
    if (willBeVisible && finalInstrumentsCount === 0) {
      res.status(400).json({ error: "Cannot publish a pattern with no instruments" });
      return;
    }

    const data: any = {};
    if (title !== undefined) data.title = normalizeQuotes(title);
    if (details !== undefined) data.details = details;
    if (isFree !== undefined) data.isFree = isFree;
    if (isNew !== undefined) data.isNew = isNew;
    if (isVisible !== undefined) {
      data.isVisible = isVisible;
      // First-ever "went live" moment — set once, never touched again by
      // later edits/re-hides (see the field comment in schema.prisma).
      if (isVisible && !existing.publishedAt) {
        data.publishedAt = new Date();
      }
    }
    if (Array.isArray(yarnRangeIds)) data.yarnRanges = { set: yarnRangeIds.map((id: string) => ({ id })) };
    if (densityStitches !== undefined) data.densityStitches = densityStitches === "" || densityStitches === null ? null : Number(densityStitches);
    if (densityRows !== undefined) data.densityRows = densityRows === "" || densityRows === null ? null : Number(densityRows);
    if (price !== undefined) data.price = price === "" || price === null ? null : Number(price);
    if (oldPrice !== undefined) data.oldPrice = oldPrice === "" || oldPrice === null ? null : Number(oldPrice);
    if (validatedImages !== undefined) {
      data.images = validatedImages;
      data.imageUrl = deriveImageUrl(validatedImages);
      data.thumbnailUrl = await generateThumbnailUrl(validatedImages[0]);
      // Removed files are deleted only after the DB update succeeds (see below).
    }

    if (url !== undefined) {
      const normUrl = normalizeUrl(url);
      const dup = await prisma.pattern.findFirst({ where: { url: normUrl, id: { not: id } } });
      if (dup) {
        res.status(400).json({ error: "URL already exists" });
        return;
      }
      data.url = normUrl;
    }

    if (authorId) {
      data.authorId = authorId;
    } else if (authorName) {
      // Legacy fallback for old admin frontend — prefer authorId going forward.
      data.authorId = await syncAuthor(authorName);
    }

    if (Array.isArray(categories)) {
      const catIds = await syncCategories(categories);
      data.categories = { set: [], connect: catIds.map(id => ({ id })) };
    }

    if (Array.isArray(tags)) {
      const tagIds = await syncTags(tags);
      data.tags = { set: [], connect: tagIds.map(id => ({ id })) };
    }

    if (Array.isArray(instruments)) {
      const instIds = await syncInstruments(instruments);
      data.instruments = { set: [], connect: instIds.map(id => ({ id })) };
    }

    const updated = await prisma.pattern.update({
      where: { id },
      data,
    });

    // Delete files removed from the gallery (only ones we host ourselves —
    // scraper-origin /images/patterns/ files are never touched, matching
    // pre-existing behavior for the single-imageUrl case).
    if (imagesDiff) {
      for (const removedUrl of imagesDiff.removed) {
        if (!isOwnUpload(removedUrl)) continue;
        try {
          const oldFile = path.join(__dirname, "../../", removedUrl);
          if (fs.existsSync(oldFile)) {
            fs.unlinkSync(oldFile);
          }
        } catch (unlinkErr) {
          console.error("[Admin] Failed to delete old image file:", unlinkErr);
        }
      }
    }

    res.json({ success: true, id: updated.id });
  } catch (error) {
    console.error("[Admin] updatePattern failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/patterns
export const createPattern = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, url, images, details, price, oldPrice, isFree, isNew, isVisible, authorId, authorName, categories, tags, instruments, yarnRangeIds, densityStitches, densityRows } = req.body;

    if (!title || !url || (!authorId && !authorName)) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    if ((isVisible ?? true) && (!Array.isArray(instruments) || instruments.length === 0)) {
      res.status(400).json({ error: "Cannot publish a pattern with no instruments" });
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

    const normUrl = normalizeUrl(url);
    const existingUrl = await prisma.pattern.findFirst({ where: { url: normUrl } });
    if (existingUrl) {
      res.status(400).json({ error: "URL already exists" });
      return;
    }

    let slug = generateSlug(title);
    const existingSlug = await prisma.pattern.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }

    const finalAuthorId = authorId ?? await syncAuthor(authorName);

    const data: any = {
      title: normalizeQuotes(title),
      url: normUrl,
      images: imagesValidation.images,
      imageUrl: deriveImageUrl(imagesValidation.images),
      thumbnailUrl: await generateThumbnailUrl(imagesValidation.images[0]),
      details: details ?? null,
      isFree: isFree ?? false,
      isNew: isNew ?? false,
      authorId: finalAuthorId,
      slug,
      isVisible: isVisible ?? true,
      publishedAt: (isVisible ?? true) ? new Date() : null,
      densityStitches: densityStitches === "" || densityStitches === undefined || densityStitches === null ? null : Number(densityStitches),
      densityRows: densityRows === "" || densityRows === undefined || densityRows === null ? null : Number(densityRows),
      price: price === "" || price === undefined || price === null ? null : Number(price),
      oldPrice: oldPrice === "" || oldPrice === undefined || oldPrice === null ? null : Number(oldPrice),
    };

    if (Array.isArray(yarnRangeIds) && yarnRangeIds.length > 0) {
      data.yarnRanges = { connect: yarnRangeIds.map((id: string) => ({ id })) };
    }

    if (Array.isArray(categories) && categories.length > 0) {
      const catIds = await syncCategories(categories);
      data.categories = { connect: catIds.map(id => ({ id })) };
    }

    if (Array.isArray(tags) && tags.length > 0) {
      const tagIds = await syncTags(tags);
      data.tags = { connect: tagIds.map(id => ({ id })) };
    }

    if (Array.isArray(instruments) && instruments.length > 0) {
      const instIds = await syncInstruments(instruments);
      data.instruments = { connect: instIds.map(id => ({ id })) };
    }

    const newPattern = await prisma.pattern.create({ data });

    res.status(201).json({ success: true, id: newPattern.id });
  } catch (error) {
    console.error("[Admin] createPattern failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/patterns/reset-new
export const resetAllIsNew = async (_req: Request, res: Response): Promise<void> => {
  try {
    const { count } = await prisma.pattern.updateMany({
      where: { isNew: true },
      data: { isNew: false },
    });
    res.json({ success: true, updated: count });
  } catch (error) {
    console.error("[Admin] resetAllIsNew failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /admin/patterns/:id (Soft delete - hide pattern)
export const deletePattern = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await prisma.pattern.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    if (!existing.isVisible) {
      // Hard delete if it's already in the archive
      await prisma.pattern.delete({ where: { id } });

      for (const imageUrl of existing.images) {
        if (!isOwnUpload(imageUrl)) continue;
        try {
          const filename = path.basename(imageUrl);
          const fullPath = path.join(__dirname, "../../uploads/patterns", filename);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        } catch (e) {
          console.error("[Admin] Failed to delete image file:", e);
        }
      }
    } else {
      // Soft delete if it's active
      await prisma.pattern.update({
        where: { id },
        data: { isVisible: false }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] deletePattern failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

