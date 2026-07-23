import { Request, Response } from "express";
import { DraftStatus, Permission } from "@prisma/client";
import { prisma } from "../prismaClient";
import fs from "fs";
import path from "path";
import { generateSlug } from "../utils/slug";

// Helpers
function normalizeUrl(urlStr: string): string {
  const trimmed = urlStr.trim();
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    let pathname = url.pathname.replace(/\/$/, "");
    if (!pathname) pathname = "/";
    return url.protocol + "//" + url.hostname + pathname + url.search + url.hash;
  } catch (e) {
    return trimmed.toLowerCase().replace(/\/$/, "");
  }
}

// find-or-create helpers with TOCTOU fix: catch P2002 and re-fetch on race.
// syncAuthor is kept for the data import path only — admin pattern forms
// must pass authorId directly (never free-text authorName).

export async function syncAuthor(name: string): Promise<string> {
  const normalized = name.trim().replace(/\s+/g, " ");
  let author = await prisma.author.findFirst({
    where: { name: { equals: normalized, mode: "insensitive" } },
  });
  if (!author) {
    try {
      author = await prisma.author.create({ data: { name: normalized } });
    } catch (e: any) {
      if (e.code === "P2002") {
        author = await prisma.author.findFirst({
          where: { name: { equals: normalized, mode: "insensitive" } },
        });
        if (!author) throw e;
      } else throw e;
    }
  }
  return author.id;
}

async function syncTags(names: string[]): Promise<string[]> {
  const normalized = [...new Set(names.map(n => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const ids: string[] = [];
  for (const name of normalized) {
    let item = await prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!item) {
      try {
        item = await prisma.tag.create({ data: { name } });
      } catch (e: any) {
        if (e.code === "P2002") {
          item = await prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
          if (!item) throw e;
        } else throw e;
      }
    }
    ids.push(item.id);
  }
  return ids;
}

async function syncCategories(names: string[]): Promise<string[]> {
  const normalized = [...new Set(names.map(n => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const ids: string[] = [];
  for (const name of normalized) {
    let item = await prisma.productType.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!item) {
      try {
        item = await prisma.productType.create({ data: { name } });
      } catch (e: any) {
        if (e.code === "P2002") {
          item = await prisma.productType.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
          if (!item) throw e;
        } else throw e;
      }
    }
    ids.push(item.id);
  }
  return ids;
}

async function syncInstruments(names: string[]): Promise<string[]> {
  const normalized = [...new Set(names.map(n => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const ids: string[] = [];
  for (const name of normalized) {
    let item = await prisma.instrument.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!item) {
      try {
        item = await prisma.instrument.create({ data: { name } });
      } catch (e: any) {
        if (e.code === "P2002") {
          item = await prisma.instrument.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
          if (!item) throw e;
        } else throw e;
      }
    }
    ids.push(item.id);
  }
  return ids;
}

/**
 * Admin API. All handlers are reached only through requireAuth + requireAdmin.
 * Shapes are intentionally simple scaffolding for the future admin panel;
 * richer aggregations are marked with TODO.
 */

// GET /admin/users/stats
export const getUsersStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [total, byRole] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    ]);

    res.json({
      total,
      byRole: byRole.map((r) => ({ role: r.role, count: r._count._all })),
    });
  } catch (error) {
    console.error("[Admin] getUsersStats failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/patterns/stats
export const getPatternsStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalPatterns, totalViews, totalLinkClicks] = await Promise.all([
      prisma.pattern.count(),
      prisma.patternView.count(),
      prisma.patternLinkClick.count(),
    ]);

    res.json({
      totalPatterns,
      totalViews,
      totalLinkClicks,
      // TODO: top patterns by views/clicks via prisma.patternView.groupBy({ by: ['patternId'] }).
      topPatterns: [],
    });
  } catch (error) {
    console.error("[Admin] getPatternsStats failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/dashboard
export const getDashboard = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [users, patterns, subscribeClicks] = await Promise.all([
      prisma.user.count(),
      prisma.pattern.count(),
      prisma.subscribeClick.count(),
    ]);

    res.json({
      // TODO: time-series, conversion funnels, active users, etc.
      totals: { users, patterns, subscribeClicks },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Admin] getDashboard failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/dashboard/stats — full dashboard data in one request
// Query params: period='7d'|'30d'|'90d'|'all'  OR  from='YYYY-MM-DD'&to='YYYY-MM-DD'
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const { period = "all", from: fromParam, to: toParam } =
      req.query as { period?: string; from?: string; to?: string };

    const now = new Date();
    let analyticsFrom: Date | undefined;
    let analyticsTo: Date | undefined;

    if (fromParam && toParam) {
      analyticsFrom = new Date(fromParam + "T00:00:00.000Z");
      analyticsTo   = new Date(toParam   + "T23:59:59.999Z");
    } else if (period === "7d") {
      analyticsFrom = new Date(now);
      analyticsFrom.setDate(analyticsFrom.getDate() - 7);
    } else if (period === "30d") {
      analyticsFrom = new Date(now);
      analyticsFrom.setDate(analyticsFrom.getDate() - 30);
    } else if (period === "90d") {
      analyticsFrom = new Date(now);
      analyticsFrom.setDate(analyticsFrom.getDate() - 90);
    }

    // When period='all' (no date filter), new-users window stays at 7 days (legacy behaviour)
    const newUsersFrom = analyticsFrom ?? (() => {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    })();
    const createdAtRange = analyticsFrom
      ? { gte: analyticsFrom, ...(analyticsTo ? { lte: analyticsTo } : {}) }
      : undefined;
    const dateFilter = createdAtRange ? { createdAt: createdAtRange } : undefined;
    const topWhere = createdAtRange
      ? { createdAt: { ...createdAtRange } }
      : undefined;

    // Raw SQL for author aggregation — groupBy can't aggregate across a joined
    // relation, so this joins PatternView/LinkClick/Favorite -> Pattern -> Author.
    // The (${x}::timestamptz IS NULL OR col >= ${x}) form keeps one static query
    // for both "all time" (null bounds) and a bounded period, instead of
    // conditionally building the WHERE clause as a string.
    const sqlFrom = analyticsFrom ?? null;
    const sqlTo = analyticsTo ?? null;

    type TopAuthorRow = { authorId: string; name: string; count: number };

    const [
      totalUsers,
      newUsersInPeriod,
      totalPatternViews,
      totalPatternLinkClicks,
      totalSubscribeClicks,
      totalFavorites,
      topViewsRaw,
      topLinkClicksRaw,
      topFavoritesRaw,
      topAuthorsByViewsRaw,
      topAuthorsByLinkClicksRaw,
      topAuthorsByFavoritesRaw,
      topSearchQueriesRaw,
    ] = await Promise.all([
      analyticsFrom
        ? prisma.user.count({ where: { lastSeenAt: { gte: analyticsFrom, ...(analyticsTo ? { lte: analyticsTo } : {}) } } })
        : prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: newUsersFrom, ...(analyticsTo ? { lte: analyticsTo } : {}) } } }),
      prisma.patternView.count({ where: dateFilter }),
      prisma.patternLinkClick.count({ where: dateFilter }),
      prisma.subscribeClick.count({ where: dateFilter }),
      prisma.userFavorite.count({ where: dateFilter }),
      prisma.patternView.groupBy({
        by: ["patternId"],
        where: topWhere,
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
        take: 10,
      }),
      prisma.patternLinkClick.groupBy({
        by: ["patternId"],
        where: topWhere,
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
        take: 10,
      }),
      prisma.userFavorite.groupBy({
        by: ["patternId"],
        where: topWhere,
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
        take: 10,
      }),
      prisma.$queryRaw<TopAuthorRow[]>`
        SELECT a.id as "authorId", a.name, COUNT(*)::int as count
        FROM "PatternView" v
        JOIN "Pattern" p ON p.id = v."patternId"
        JOIN "Author" a ON a.id = p."authorId"
        WHERE (${sqlFrom}::timestamptz IS NULL OR v."createdAt" >= ${sqlFrom}::timestamptz)
          AND (${sqlTo}::timestamptz IS NULL OR v."createdAt" <= ${sqlTo}::timestamptz)
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.$queryRaw<TopAuthorRow[]>`
        SELECT a.id as "authorId", a.name, COUNT(*)::int as count
        FROM "PatternLinkClick" v
        JOIN "Pattern" p ON p.id = v."patternId"
        JOIN "Author" a ON a.id = p."authorId"
        WHERE (${sqlFrom}::timestamptz IS NULL OR v."createdAt" >= ${sqlFrom}::timestamptz)
          AND (${sqlTo}::timestamptz IS NULL OR v."createdAt" <= ${sqlTo}::timestamptz)
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.$queryRaw<TopAuthorRow[]>`
        SELECT a.id as "authorId", a.name, COUNT(*)::int as count
        FROM "UserFavorite" v
        JOIN "Pattern" p ON p.id = v."patternId"
        JOIN "Author" a ON a.id = p."authorId"
        WHERE (${sqlFrom}::timestamptz IS NULL OR v."createdAt" >= ${sqlFrom}::timestamptz)
          AND (${sqlTo}::timestamptz IS NULL OR v."createdAt" <= ${sqlTo}::timestamptz)
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.searchQuery.groupBy({
        by: ["query"],
        where: dateFilter,
        _count: { query: true },
        orderBy: { _count: { query: "desc" } },
        take: 10,
      }),
    ]);

    // Collect all unique patternIds we need titles for
    const allPatternIds = [
      ...new Set([
        ...topViewsRaw.map((r) => r.patternId),
        ...topLinkClicksRaw.map((r) => r.patternId),
        ...topFavoritesRaw.map((r) => r.patternId),
      ]),
    ];

    const patterns = await prisma.pattern.findMany({
      where: { id: { in: allPatternIds } },
      select: { id: true, title: true, url: true, author: { select: { name: true } } },
    });
    const patternMap = new Map(patterns.map((p) => [p.id, p]));

    const toTopList = (raw: { patternId: string; _count: { patternId: number } }[]) =>
      raw.map((r) => {
        const p = patternMap.get(r.patternId);
        return {
          patternId: r.patternId,
          title: p?.title ?? "—",
          authorName: p?.author.name ?? "—",
          url: p?.url ?? "",
          count: r._count.patternId,
        };
      });

    res.json({
      stats: {
        totalUsers,
        newUsersInPeriod,
        totalPatternViews,
        totalPatternLinkClicks,
        totalSubscribeClicks,
        totalFavorites,
      },
      topByViews: toTopList(topViewsRaw),
      topByLinkClicks: toTopList(topLinkClicksRaw),
      topByFavorites: toTopList(topFavoritesRaw),
      topAuthorsByViews: topAuthorsByViewsRaw,
      topAuthorsByLinkClicks: topAuthorsByLinkClicksRaw,
      topAuthorsByFavorites: topAuthorsByFavoritesRaw,
      topSearchQueries: topSearchQueriesRaw.map((r) => ({
        query: r.query,
        count: r._count.query,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Admin] getDashboardStats failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

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
      preview: pattern.imageUrl,
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
    const { title, url, imageUrl, isFree, isNew, authorId, authorName, isVisible, categories, tags, instruments, yarnRangeIds, densityStitches, densityRows } = req.body;

    const existing = await prisma.pattern.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Pattern not found" });
      return;
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

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (isFree !== undefined) data.isFree = isFree;
    if (isNew !== undefined) data.isNew = isNew;
    if (isVisible !== undefined) data.isVisible = isVisible;
    if (Array.isArray(yarnRangeIds)) data.yarnRanges = { set: yarnRangeIds.map((id: string) => ({ id })) };
    if (densityStitches !== undefined) data.densityStitches = densityStitches === "" || densityStitches === null ? null : Number(densityStitches);
    if (densityRows !== undefined) data.densityRows = densityRows === "" || densityRows === null ? null : Number(densityRows);
    if (imageUrl !== undefined && imageUrl !== existing.imageUrl) {
      data.imageUrl = imageUrl;
      // Old image file is deleted only after the DB update succeeds (see below).
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

    // Delete old image if it was replaced
    if (data.imageUrl && existing.imageUrl && data.imageUrl !== existing.imageUrl) {
      if (existing.imageUrl.startsWith("/uploads/")) {
        try {
          const oldFile = path.join(__dirname, "../../", existing.imageUrl);
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
    const { title, url, imageUrl, isFree, isNew, isVisible, authorId, authorName, categories, tags, instruments, yarnRangeIds, densityStitches, densityRows } = req.body;

    if (!title || !url || !imageUrl || (!authorId && !authorName)) {
      res.status(400).json({ error: "Missing required fields" });
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
      title,
      url: normUrl,
      imageUrl,
      isFree: isFree ?? false,
      isNew: isNew ?? false,
      authorId: finalAuthorId,
      slug,
      isVisible: isVisible ?? true,
      densityStitches: densityStitches === "" || densityStitches === undefined || densityStitches === null ? null : Number(densityStitches),
      densityRows: densityRows === "" || densityRows === undefined || densityRows === null ? null : Number(densityRows),
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

      if (existing.imageUrl && existing.imageUrl.startsWith("/uploads/")) {
        try {
          const filename = path.basename(existing.imageUrl);
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

// AUTHORS CRUD

export const getAuthors = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const where = search ? { name: { contains: search, mode: "insensitive" as any } } : undefined;

    const authors = await prisma.author.findMany({
      where,
      include: {
        _count: {
          select: { patterns: true }
        }
      },
      orderBy: { name: 'asc' }
    });
    
    const mapped = authors.map(a => ({
      id: a.id,
      name: a.name,
      site: a.site,
      patternsCount: a._count.patterns
    }));

    res.json(mapped);
  } catch (error) {
    console.error("[Admin] getAuthors failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const createAuthor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, site } = req.body;
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const author = await prisma.author.create({
      data: { name, site: site || null }
    });
    res.status(201).json(author);
  } catch (error: any) {
    console.error("[Admin] createAuthor failed:", error);
    if (error.code === 'P2002') {
      res.status(400).json({ error: "Author with this name already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateAuthor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, site } = req.body;

    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const author = await prisma.author.update({
      where: { id },
      data: { name, site: site || null }
    });
    res.json(author);
  } catch (error: any) {
    console.error("[Admin] updateAuthor failed:", error);
    if (error.code === 'P2002') {
      res.status(400).json({ error: "Author with this name already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteAuthor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const count = await prisma.pattern.count({
      where: { authorId: id }
    });

    if (count > 0) {
      res.status(400).json({ error: `Cannot delete author. There are ${count} related patterns.` });
      return;
    }

    await prisma.author.delete({
      where: { id }
    });
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] deleteAuthor failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// DICTIONARIES (Categories, Tags, Instruments)
export const getCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const categories = await prisma.productType.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { patterns: true } } },
    });
    res.json(categories.map(c => ({ id: c.id, name: c.name, patternsCount: c._count.patterns })));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
    const category = await prisma.productType.update({ where: { id }, data: { name: name.trim() } });
    res.json({ id: category.id, name: category.name });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Category not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.productType.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Category not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getTags = async (req: Request, res: Response): Promise<void> => {
  try {
    const tags = await prisma.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { patterns: true } } },
    });
    res.json(tags.map(t => ({ id: t.id, name: t.name, patternsCount: t._count.patterns })));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateTag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
    const tag = await prisma.tag.update({ where: { id }, data: { name: name.trim() } });
    res.json({ id: tag.id, name: tag.name });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Tag not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteTag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.tag.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Tag not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getInstruments = async (req: Request, res: Response): Promise<void> => {
  try {
    const instruments = await prisma.instrument.findMany({ orderBy: { name: 'asc' } });
    res.json(instruments.map(i => ({ id: i.id, name: i.name })));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/yarn-ranges — fixed thickness buckets, not user-creatable.
export const getYarnRanges = async (req: Request, res: Response): Promise<void> => {
  try {
    const ranges = await prisma.yarnRange.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json(ranges.map(r => ({ id: r.id, label: r.label, minValue: r.minValue, maxValue: r.maxValue })));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

function fixQuotes(title: string): string {
  let isOpen = true;
  return title.replace(/"/g, () => {
    const q = isOpen ? '«' : '»';
    isOpen = !isOpen;
    return q;
  });
}

export const fixArchiveQuotes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const patterns = await prisma.pattern.findMany({
      where: { title: { contains: '"' } },
      select: { id: true, title: true },
    });

    if (patterns.length === 0) {
      res.json({ updated: 0 });
      return;
    }

    await Promise.all(
      patterns.map((p) =>
        prisma.pattern.update({ where: { id: p.id }, data: { title: fixQuotes(p.title) } })
      )
    );

    res.json({ updated: patterns.length });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// Stage 3 — Moderation, user-author linking, permission management
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
      },
    });

    res.json(drafts);
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

    res.json(draft);
  } catch (error) {
    console.error("[Admin] getDraftById failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/drafts/:id/approve
export const approveDraft = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const adminId = req.user!.userId;

  try {
    await prisma.$transaction(async (tx) => {
      const draft = await tx.draft.findUnique({
        where: { id },
        include: {
          tags: { select: { id: true } },
          categories: { select: { id: true } },
          instruments: { select: { id: true } },
          yarnRanges: { select: { id: true } },
        },
      });

      if (!draft) throw Object.assign(new Error("NOT_FOUND"), { status: 404 });
      if (draft.closedAt) throw Object.assign(new Error("ALREADY_CLOSED"), { status: 409 });
      if (draft.status !== DraftStatus.PENDING)
        throw Object.assign(new Error("NOT_PENDING"), { status: 409 });

      const tagConnect = draft.tags.map((t) => ({ id: t.id }));
      const catConnect = draft.categories.map((c) => ({ id: c.id }));
      const instConnect = draft.instruments.map((i) => ({ id: i.id }));
      const yarnRangeConnect = draft.yarnRanges.map((y) => ({ id: y.id }));

      if (draft.patternId === null) {
        // New pattern — generate slug + check URL uniqueness
        let slug = generateSlug(draft.title);
        const slugExists = await tx.pattern.findUnique({ where: { slug } });
        if (slugExists) slug = `${slug}-${Date.now()}`;

        const normUrl = normalizeUrl(draft.url);
        const urlExists = await tx.pattern.findFirst({ where: { url: normUrl } });
        if (urlExists) throw Object.assign(new Error("URL_DUPLICATE"), { status: 409 });

        await tx.pattern.create({
          data: {
            slug,
            title: draft.title,
            url: normUrl,
            imageUrl: draft.imageUrl,
            isFree: draft.isFree,
            isNew: draft.isNew,
            isVisible: true,
            authorId: draft.authorId,
            densityStitches: draft.densityStitches,
            densityRows: draft.densityRows,
            tags: { connect: tagConnect },
            categories: { connect: catConnect },
            instruments: { connect: instConnect },
            yarnRanges: { connect: yarnRangeConnect },
          },
        });
      } else {
        // Edit existing pattern
        await tx.pattern.update({
          where: { id: draft.patternId },
          data: {
            title: draft.title,
            url: normalizeUrl(draft.url),
            imageUrl: draft.imageUrl,
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

    res.json({ success: true });
  } catch (error: any) {
    if (error.status === 404) { res.status(404).json({ error: "Draft not found" }); return; }
    if (error.message === "ALREADY_CLOSED") { res.status(409).json({ error: "Draft is already closed" }); return; }
    if (error.message === "NOT_PENDING") { res.status(409).json({ error: "Only PENDING drafts can be approved" }); return; }
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

// GET /admin/permissions?userId=xxx
export const getPermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.query as { userId?: string };
    const where = userId ? { userId } : undefined;

    const permissions = await prisma.userPermission.findMany({
      where,
      include: { user: { select: { id: true, username: true, firstName: true } } },
      orderBy: { userId: "asc" },
    });

    res.json(permissions);
  } catch (error) {
    console.error("[Admin] getPermissions failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/permissions — { userId, permission }
export const grantPermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, permission } = req.body;
    if (!userId || !permission) {
      res.status(400).json({ error: "userId and permission are required" });
      return;
    }
    if (!Object.values(Permission).includes(permission)) {
      res.status(400).json({ error: "Invalid permission value" });
      return;
    }

    const entry = await prisma.userPermission.upsert({
      where: { userId_permission: { userId, permission } },
      create: { userId, permission },
      update: {},
    });

    res.status(201).json(entry);
  } catch (error: any) {
    if (error.code === "P2003") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    console.error("[Admin] grantPermission failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /admin/permissions/:userId/:permission
export const revokePermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, permission } = req.params;

    await prisma.userPermission.delete({
      where: { userId_permission: { userId, permission: permission as Permission } },
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Permission entry not found" });
      return;
    }
    console.error("[Admin] revokePermission failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
