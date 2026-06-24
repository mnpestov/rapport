import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import fs from "fs";
import path from "path";

// Helpers
function normalizeUrl(urlStr: string): string {
  const trimmed = urlStr.trim();
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    let pathname = url.pathname.replace(/\/$/, "");
    if (!pathname) pathname = "/";
    return url.protocol + "//" + url.hostname + pathname + url.search;
  } catch (e) {
    return trimmed.toLowerCase().replace(/\/$/, "");
  }
}

async function syncAuthor(name: string): Promise<string> {
  const normalized = name.trim().replace(/\s+/g, " ");
  let author = await prisma.author.findFirst({
    where: { name: { equals: normalized, mode: "insensitive" } },
  });
  if (!author) author = await prisma.author.create({ data: { name: normalized } });
  return author.id;
}

async function syncTags(names: string[]): Promise<string[]> {
  const normalized = [...new Set(names.map(n => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const ids: string[] = [];
  for (const name of normalized) {
    let item = await prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!item) item = await prisma.tag.create({ data: { name } });
    ids.push(item.id);
  }
  return ids;
}

async function syncCategories(names: string[]): Promise<string[]> {
  const normalized = [...new Set(names.map(n => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const ids: string[] = [];
  for (const name of normalized) {
    let item = await prisma.productType.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!item) item = await prisma.productType.create({ data: { name } });
    ids.push(item.id);
  }
  return ids;
}

async function syncInstruments(names: string[]): Promise<string[]> {
  const normalized = [...new Set(names.map(n => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const ids: string[] = [];
  for (const name of normalized) {
    let item = await prisma.instrument.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!item) item = await prisma.instrument.create({ data: { name } });
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
export const getDashboardStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      totalUsers,
      newUsersLast7Days,
      totalPatternViews,
      totalPatternLinkClicks,
      totalSubscribeClicks,
      totalFavorites,
      topViewsRaw,
      topLinkClicksRaw,
      topFavoritesRaw,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.patternView.count(),
      prisma.patternLinkClick.count(),
      prisma.subscribeClick.count(),
      prisma.userFavorite.count(),
      prisma.patternView.groupBy({
        by: ["patternId"],
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
        take: 10,
      }),
      prisma.patternLinkClick.groupBy({
        by: ["patternId"],
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
        take: 10,
      }),
      prisma.userFavorite.groupBy({
        by: ["patternId"],
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
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
      select: { id: true, title: true },
    });
    const titleMap = new Map(patterns.map((p) => [p.id, p.title]));

    const toTopList = (raw: { patternId: string; _count: { patternId: number } }[]) =>
      raw.map((r) => ({
        patternId: r.patternId,
        title: titleMap.get(r.patternId) ?? "—",
        count: r._count.patternId,
      }));

    res.json({
      stats: {
        totalUsers,
        newUsersLast7Days,
        totalPatternViews,
        totalPatternLinkClicks,
        totalSubscribeClicks,
        totalFavorites,
      },
      topByViews: toTopList(topViewsRaw),
      topByLinkClicks: toTopList(topLinkClicksRaw),
      topByFavorites: toTopList(topFavoritesRaw),
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
      isVisible: pattern.isVisible,
      createdAt: pattern.createdAt,
      updatedAt: pattern.updatedAt,
      author: {
        id: pattern.author.id,
        name: pattern.author.name,
      },
      categories: pattern.categories.map((c) => ({ id: c.id, name: c.name })),
      tags: pattern.tags.map((t) => ({ id: t.id, name: t.name })),
      instruments: pattern.instruments.map((i) => ({ id: i.id, name: i.name })),
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
    const { title, url, imageUrl, isFree, authorName, isVisible, categories, tags, instruments } = req.body;

    const existing = await prisma.pattern.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (isFree !== undefined) data.isFree = isFree;
    if (isVisible !== undefined) data.isVisible = isVisible;
    if (imageUrl !== undefined && imageUrl !== existing.imageUrl) {
      data.imageUrl = imageUrl;
      
      if (existing.imageUrl && existing.imageUrl.startsWith("/uploads/")) {
        try {
          const filename = path.basename(existing.imageUrl);
          const fullPath = path.join(__dirname, "../../uploads/patterns", filename);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        } catch (e) {
          console.error("[Admin] Failed to delete old image file during update:", e);
        }
      }
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

    if (authorName) {
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
    const { title, url, imageUrl, isFree, authorName, categories, tags, instruments } = req.body;
    
    if (!title || !url || !imageUrl || !authorName) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const normUrl = normalizeUrl(url);
    const existingUrl = await prisma.pattern.findFirst({ where: { url: normUrl } });
    if (existingUrl) {
      res.status(400).json({ error: "URL already exists" });
      return;
    }

    let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
    if (!slug) slug = `pattern-${Date.now()}`;
    const existingSlug = await prisma.pattern.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }

    const finalAuthorId = await syncAuthor(authorName);
    
    const data: any = {
      title,
      url: normUrl,
      imageUrl,
      isFree: isFree ?? false,
      authorId: finalAuthorId,
      slug,
      isVisible: true,
    };

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
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const author = await prisma.author.create({
      data: { name }
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
    const { name } = req.body;
    
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const author = await prisma.author.update({
      where: { id },
      data: { name }
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
    const categories = await prisma.productType.findMany({ orderBy: { name: 'asc' } });
    res.json(categories.map(c => ({ id: c.id, name: c.name })));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getTags = async (req: Request, res: Response): Promise<void> => {
  try {
    const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });
    res.json(tags.map(t => ({ id: t.id, name: t.name })));
  } catch (error) {
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
