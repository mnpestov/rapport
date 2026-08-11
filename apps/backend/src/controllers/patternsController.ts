import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { buildPatternWhere, stripPremiumFacetParams } from "../utils/patternFilters";
import { PATTERN_PRICE_OMIT, PATTERN_CORE_OMIT, PATTERN_DETAILS_OMIT, hasExtra, hasCore, hasDetails } from "../utils/patternVisibility";

// Shared by every endpoint that returns a list of patterns (catalog, batch-
// by-ids, similar) — maps the Prisma relations down to the flat shape the
// frontend list/card views expect.
const mapPatternListItem = (p: any) => ({
  ...p,
  author: p.author?.name || 'Неизвестно',
  instruments: p.instruments.map((i: any) => i.name),
  productTypes: p.categories.map((pt: any) => pt.name),
  tags: p.tags.map((t: any) => t.name),
  primaryProductType: p.categories[0]?.name || '',
  externalLink: p.url || ''
});

export const getPatterns = async (req: Request, res: Response) => {
  try {
    const { search, isFree, isNew, limit, offset } = req.query;

    const where: any = buildPatternWhere(stripPremiumFacetParams(req.query, hasCore(req)));

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
    const extra = hasExtra(req);

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
        // extra URLs per pattern; see pattern_images_plan.md риск №8). Same
        // reasoning for details — long free text, only ever shown on the
        // detail page — omitted here for EVERYONE regardless of role, purely
        // for payload size. price/oldPrice require PREMIUM_EXTRA, omitted on
        // top of that otherwise — see PAID_TIER_PERMISSIONS_PLAN.md §3.2.
        omit: { images: true, details: true, ...(extra ? {} : PATTERN_PRICE_OMIT) },
        include: {
          author: true,
          instruments: true,
          categories: true,
          tags: true,
        }
      }),
      prisma.pattern.count({ where })
    ]);

    const mappedPatterns = patterns.map(mapPatternListItem);

    res.json({ data: mappedPatterns, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch patterns" });
  }
};

export const getPatternById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const extra = hasExtra(req);
    const core = hasCore(req);
    const details = hasDetails(req);
    const pattern = await prisma.pattern.findFirst({
      where: { id, isVisible: true },
      // The only endpoint that reads a Pattern with no omit at all before
      // this — price/oldPrice require PREMIUM_EXTRA, densityStitches/
      // densityRows require PREMIUM_CORE, details requires its own
      // PREMIUM_DETAILS (split out from PREMIUM_EXTRA — worse parse quality,
      // rolled out independently) — see PAID_TIER_PERMISSIONS_PLAN.md §3.2/§3.3.
      omit: { ...(extra ? {} : PATTERN_PRICE_OMIT), ...(core ? {} : PATTERN_CORE_OMIT), ...(details ? {} : PATTERN_DETAILS_OMIT) },
      include: {
        author: true,
        instruments: true,
        categories: true,
        tags: true,
        // yarnRanges is a relation, not omit-able — only include it at all
        // when PREMIUM_CORE is present (mirrors densityStitches/densityRows).
        ...(core ? { yarnRanges: { select: { label: true } } } : {}),
      }
    });

    if (!pattern) {
      return res.status(404).json({ error: "Pattern not found" });
    }

    const mappedPattern = {
      ...pattern,
      // Full gallery requires PREMIUM_EXTRA too — everyone else gets just the
      // cover. ImageCarousel already collapses to a single <img> when
      // images.length <= 1, so the frontend needs no change for this.
      images: extra ? pattern.images : [],
      author: pattern.author?.name || 'Неизвестно',
      instruments: pattern.instruments.map(i => i.name),
      productTypes: pattern.categories.map(pt => pt.name),
      tags: pattern.tags.map(t => t.name),
      yarnRanges: core ? (pattern as any).yarnRanges.map((y: any) => y.label) : [],
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
    const extra = hasExtra(req);

    const patterns = await prisma.pattern.findMany({
      where: {
        id: { in: validIds },
        isVisible: true
      },
      // Same reasoning as getPatterns — this feeds list/thumbnail views
      // (e.g. favorites), never the detail page's gallery or details block.
      // price/oldPrice premium-gated the same way too.
      omit: { images: true, details: true, ...(extra ? {} : PATTERN_PRICE_OMIT) },
      include: {
        author: true,
        instruments: true,
        categories: true,
        tags: true,
      }
    });

    const patternsMap = new Map(patterns.map(p => [p.id, p]));
    const orderedPatterns = validIds.map(id => patternsMap.get(id)).filter(p => p !== undefined) as typeof patterns;

    const mappedPatterns = orderedPatterns.map(mapPatternListItem);

    res.json({ data: mappedPatterns });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch patterns by ids" });
  }
};

const SIMILAR_LIMIT = 12;
// Below this, tier 1 (category + characteristics) is considered too thin —
// broaden to category-only rather than show a near-empty "Похожие описания" row.
const SIMILAR_MIN_RESULTS = 4;

// GET /patterns/:id/similar — "Похожие описания" on the detail page. Tiered
// matching: category AND characteristics (tags) first; if that's too thin,
// broaden to category alone (a strict superset, so it always yields at least
// as many results as tier 1 — no merge needed, just replace). Empty
// categories/tags on the source pattern mean nothing to match on, so the
// endpoint returns an empty list rather than falling back to "recent" or
// anything unrelated to the source pattern.
export const getSimilarPatterns = async (req: Request, res: Response) => {
  try {
    // "Похожие описания" is a premium feature in its own right (not just a
    // premium-field omission within it) — anyone without PREMIUM_EXTRA gets
    // an empty list, indistinguishable on the frontend from "genuinely
    // nothing similar found", without running the query at all.
    // See PAID_TIER_PERMISSIONS_PLAN.md §3.2.
    if (!hasExtra(req)) {
      return res.json({ data: [] });
    }

    const { id } = req.params;

    const source = await prisma.pattern.findFirst({
      where: { id, isVisible: true },
      select: {
        categories: { select: { id: true } },
        tags: { select: { id: true } },
      },
    });

    if (!source) {
      return res.status(404).json({ error: "Pattern not found" });
    }

    const categoryIds = source.categories.map(c => c.id);
    const tagIds = source.tags.map(t => t.id);

    const fetchSimilar = (where: any) => prisma.pattern.findMany({
      where,
      take: SIMILAR_LIMIT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      omit: { images: true, details: true },
      include: { author: true, instruments: true, categories: true, tags: true },
    });

    const baseWhere = { isVisible: true, id: { not: id } };
    let patterns: Awaited<ReturnType<typeof fetchSimilar>> = [];

    if (categoryIds.length > 0 && tagIds.length > 0) {
      patterns = await fetchSimilar({
        ...baseWhere,
        categories: { some: { id: { in: categoryIds } } },
        tags: { some: { id: { in: tagIds } } },
      });
    }

    if (patterns.length < SIMILAR_MIN_RESULTS && categoryIds.length > 0) {
      patterns = await fetchSimilar({
        ...baseWhere,
        categories: { some: { id: { in: categoryIds } } },
      });
    }

    res.json({ data: patterns.map(mapPatternListItem) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch similar patterns" });
  }
};
