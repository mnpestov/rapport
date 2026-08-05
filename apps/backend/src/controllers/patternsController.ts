import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { buildPatternWhere } from "../utils/patternFilters";

export const getPatterns = async (req: Request, res: Response) => {
  try {
    const { search, isFree, isNew, limit, offset } = req.query;

    const where: any = buildPatternWhere(req.query);

    if (search && typeof search === 'string') {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { author: { name: { contains: search, mode: 'insensitive' } } },
        { categories: { some: { name: { contains: search, mode: 'insensitive' } } } },
        { instruments: { some: { name: { contains: search, mode: 'insensitive' } } } },
        { tags: { some: { name: { contains: search, mode: 'insensitive' } } } }
      ];
    }

    if (isFree === 'true') {
      where.isFree = true;
    }

    if (isNew === 'true') {
      where.isNew = true;
    }

    const take = limit ? parseInt(limit as string, 10) : 10;
    const skip = offset ? parseInt(offset as string, 10) : 0;

    const [patterns, total] = await Promise.all([
      prisma.pattern.findMany({
        where,
        take,
        skip,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'asc' }
        ],
        // Listing only ever renders the cover (imageUrl) — omit the gallery
        // array so it doesn't bloat every catalog page response (up to 5
        // extra URLs per pattern; see pattern_images_plan.md риск №8).
        omit: { images: true },
        include: {
          author: true,
          instruments: true,
          categories: true,
          tags: true,
        }
      }),
      prisma.pattern.count({ where })
    ]);

    const mappedPatterns = patterns.map(p => ({
      ...p,
      author: p.author?.name || 'Неизвестно',
      instruments: p.instruments.map(i => i.name),
      productTypes: p.categories.map(pt => pt.name),
      tags: p.tags.map(t => t.name),
      primaryProductType: p.categories[0]?.name || '',
      externalLink: p.url || ''
    }));

    res.json({ data: mappedPatterns, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch patterns" });
  }
};

export const getPatternById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pattern = await prisma.pattern.findFirst({
      where: { id, isVisible: true },
      include: {
        author: true,
        instruments: true,
        categories: true,
        tags: true,
        yarnRanges: { select: { label: true } },
      }
    });

    if (!pattern) {
      return res.status(404).json({ error: "Pattern not found" });
    }

    const mappedPattern = {
      ...pattern,
      author: pattern.author?.name || 'Неизвестно',
      instruments: pattern.instruments.map(i => i.name),
      productTypes: pattern.categories.map(pt => pt.name),
      tags: pattern.tags.map(t => t.name),
      yarnRanges: pattern.yarnRanges.map(y => y.label),
      primaryProductType: pattern.categories[0]?.name || '',
      externalLink: pattern.url || ''
    };

    res.json(mappedPattern);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch pattern" });
  }
};

export const getPatternsByIds = async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.json({ data: [] });
    }

    const validIds = ids.filter((id): id is string => typeof id === "string").slice(0, 500);

    const patterns = await prisma.pattern.findMany({
      where: {
        id: { in: validIds },
        isVisible: true
      },
      // Same reasoning as getPatterns — this feeds list/thumbnail views
      // (e.g. favorites), never the detail page's gallery.
      omit: { images: true },
      include: {
        author: true,
        instruments: true,
        categories: true,
        tags: true,
      }
    });

    const patternsMap = new Map(patterns.map(p => [p.id, p]));
    const orderedPatterns = validIds.map(id => patternsMap.get(id)).filter(p => p !== undefined) as typeof patterns;

    const mappedPatterns = orderedPatterns.map(p => ({
      ...p,
      author: p.author?.name || 'Неизвестно',
      instruments: p.instruments.map(i => i.name),
      productTypes: p.categories.map(pt => pt.name),
      tags: p.tags.map(t => t.name),
      primaryProductType: p.categories[0]?.name || '',
      externalLink: p.url || ''
    }));

    res.json({ data: mappedPatterns });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch patterns by ids" });
  }
};
