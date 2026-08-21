import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { buildPatternWhere, stripPremiumFacetParams } from "../utils/patternFilters";
import { PATTERN_PRICE_OMIT, PATTERN_CORE_OMIT, PATTERN_DETAILS_OMIT, hasExtra, hasCore, hasDetails } from "../utils/patternVisibility";

// Shared by every endpoint that returns a list of patterns (catalog, batch-
// by-ids, similar) — maps the Prisma relations down to the flat shape the
// frontend list/card views expect.
const mapPatternListItem = (p: any) => ({
  ...p,
  // Falls back to full-quality imageUrl while thumbnailUrl is still null
  // (not yet backfilled for this row) — never omit the field outright, see
  // image_pipeline_plan.md.
  thumbnailUrl: p.thumbnailUrl || p.imageUrl,
  author: p.author?.name || 'Неизвестно',
  instruments: p.instruments.map((i: any) => i.name),
  productTypes: p.categories.map((pt: any) => pt.name),
  tags: p.tags.map((t: any) => t.name),
  primaryProductType: p.categories[0]?.name || '',
  externalLink: p.url || '',
  // Id counterparts of the name arrays above — needed anywhere filtering
  // has to match FilterModal's id-based SelectedFilters against an
  // already-fetched pattern list client-side (currently: favorites page).
  // Purely additive, same names/values regardless of caller.
  categoryIds: p.categories.map((pt: any) => pt.id),
  tagIds: p.tags.map((t: any) => t.id),
  instrumentIds: p.instruments.map((i: any) => i.id),
});

export const getPatterns = async (req: Request, res: Response) => {
  try {
    const { search, isFree, isNew, isDiscount, sort, priceMin, priceMax, limit, offset } = req.query;

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

    const extra = hasExtra(req);
    const core = hasCore(req);

    // Both isDiscount and priceMin/priceMax constrain the same `price`
    // column — built into ONE object (not two separate assignments) so a
    // combination like "Скидка" + "от 500" doesn't have the second silently
    // clobber the first via plain overwrite. Non-extra requests never
    // receive price/oldPrice at all (PATTERN_PRICE_OMIT below), so all three
    // params are silently ignored rather than filtering against fields that
    // don't exist for them — same precedent as isDiscount already had.
    if (extra) {
      const priceConstraint: { gt?: number; gte?: number; lte?: number } = {};
      if (isDiscount === 'true') {
        where.oldPrice = { not: null };
        priceConstraint.gt = 0;
      }
      const min = typeof priceMin === 'string' ? parseFloat(priceMin) : NaN;
      const max = typeof priceMax === 'string' ? parseFloat(priceMax) : NaN;
      if (!isNaN(min)) priceConstraint.gte = min;
      if (!isNaN(max)) priceConstraint.lte = max;
      if (Object.keys(priceConstraint).length > 0) {
        where.price = priceConstraint;
      }
    }

    // publishedAt (not createdAt) is the "actual went live" moment — see the
    // field comment in schema.prisma and expireNewPatternsJob, which already
    // anchors on it for the same reason (sync-imported patterns sit
    // invisible in review before publication, so createdAt can predate what
    // users actually see by however long that takes). price_asc/price_desc
    // silently fall back to the default (rather than erroring) for
    // non-PREMIUM_EXTRA requests — same precedent as isDiscount above, since
    // those requests never receive price/oldPrice to make sense of the
    // ordering anyway. price is nullable (free items, always NULL not 0 —
    // verified live) so both directions push NULLs to the end rather than
    // clustering free items at the top of "Дороже".
    let orderBy: any = [{ publishedAt: 'desc' }, { id: 'asc' }];
    if (sort === 'price_asc' && extra) {
      orderBy = [{ price: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
    } else if (sort === 'price_desc' && extra) {
      orderBy = [{ price: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
    }

    const take = limit ? parseInt(limit as string, 10) : 10;
    const skip = offset ? parseInt(offset as string, 10) : 0;

    const [patterns, total] = await Promise.all([
      prisma.pattern.findMany({
        where,
        take,
        skip,
        orderBy,
        // Listing only ever renders the cover (imageUrl) — omit the gallery
        // array so it doesn't bloat every catalog page response (up to 5
        // extra URLs per pattern; see pattern_images_plan.md риск №8). Same
        // reasoning for details — long free text, only ever shown on the
        // detail page — omitted here for EVERYONE regardless of role, purely
        // for payload size. price/oldPrice require PREMIUM_EXTRA, densityStitches/
        // densityRows require PREMIUM_CORE — omitted on top of that otherwise,
        // same gate getPatternById already applies (this list endpoint didn't
        // until now — densityStitches/densityRows were plain scalar columns
        // with no omit, so Prisma returned them unconditionally even though
        // nothing here rendered them; closing that gap since favorites'
        // client-side density filter is about to make real use of the field
        // on another endpoint reusing this same premium-gate pattern).
        // See PAID_TIER_PERMISSIONS_PLAN.md §3.2/§3.3.
        omit: { images: true, details: true, ...(extra ? {} : PATTERN_PRICE_OMIT), ...(core ? {} : PATTERN_CORE_OMIT) },
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
      // Card-sized derivative, for potential card-style reuse of this
      // response — NOT what the detail page's own gallery/fallback should
      // read (that's imageUrl/images, kept full quality on purpose, see
      // image_pipeline_plan.md and thumbnailUrl's schema comment).
      thumbnailUrl: pattern.thumbnailUrl || pattern.imageUrl,
      // Full gallery requires PREMIUM_EXTRA too — everyone else gets just the
      // cover. ImageCarousel already collapses to a single <img> when
      // images.length <= 1, so the frontend needs no change for this.
      images: extra ? pattern.images : [],
      author: pattern.author?.name || 'Неизвестно',
      // Only mapped here, not in mapPatternListItem — only the detail
      // page's Footer ("Источник информации: ...") ever reads it, same
      // "only where it's actually rendered" reasoning as images/details
      // being list-endpoint-only in the opposite direction. Not
      // premium-gated: Author.site is public info about the seller, not
      // pattern content.
      authorSite: pattern.author?.site || null,
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

    // 500/request is a defensive cap, not tied to any body-size limit
    // (express.json()'s default 100kb comfortably fits far more than 500
    // UUIDs) — callers with more favorites than this are expected to chunk
    // into multiple parallel requests and merge client-side, not raise this
    // number.
    const validIds = ids.filter((id): id is string => typeof id === "string").slice(0, 500);
    const extra = hasExtra(req);
    const core = hasCore(req);

    const patterns = await prisma.pattern.findMany({
      where: {
        id: { in: validIds },
        isVisible: true
      },
      // Same reasoning as getPatterns — this feeds list/thumbnail views
      // (e.g. favorites), never the detail page's gallery or details block.
      // price/oldPrice and densityStitches/densityRows premium-gated the
      // same way getPatternById already does.
      omit: { images: true, details: true, ...(extra ? {} : PATTERN_PRICE_OMIT), ...(core ? {} : PATTERN_CORE_OMIT) },
      include: {
        author: true,
        instruments: true,
        categories: true,
        tags: true,
        // Only for PREMIUM_CORE — needed by the favorites page's client-side
        // "Толщина пряжи" filter, which has to match FilterModal's
        // SelectedFilters.yarnRanges (ids) against each already-fetched
        // pattern without a server round-trip. Id only, not label — the
        // label list itself comes from /filters, same as Catalog.
        ...(core ? { yarnRanges: { select: { id: true } } } : {}),
      }
    });

    const patternsMap = new Map(patterns.map(p => [p.id, p]));
    const orderedPatterns = validIds.map(id => patternsMap.get(id)).filter(p => p !== undefined) as typeof patterns;

    const mappedPatterns = orderedPatterns.map((p: any) => {
      // Strip the raw yarnRanges relation array before the shared mapper
      // spreads `...p` — replaced with the flat yarnRangeIds below so the
      // response shape stays consistent (never a stray {id}[] object array).
      const { yarnRanges, ...rest } = p;
      return {
        ...mapPatternListItem(rest),
        ...(core ? { yarnRangeIds: (yarnRanges || []).map((y: any) => y.id) } : {}),
      };
    });

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

// "детское" is never treated as a droppable characteristic tag like the
// others — a kids pattern must only surface kids "similar" results, and a
// non-kids pattern must never surface kids ones, at EVERY tier (including
// the category-only fallback where every other tag gets dropped).
const CHILDREN_TAG_NAME = 'детское';

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
        tags: { select: { id: true, name: true } },
      },
    });

    if (!source) {
      return res.status(404).json({ error: "Pattern not found" });
    }

    const categoryIds = source.categories.map(c => c.id);
    const tagIds = source.tags.map(t => t.id);
    const isChildren = source.tags.some(t => t.name === CHILDREN_TAG_NAME);
    // Kept separate from the two tiers below (rather than folded into their
    // own `tags` clause) since a Prisma where object can only hold one
    // `tags` key — tier 1 already needs its own `tags: { some: { id: in
    // tagIds } } }` for the characteristics match, and tier 2 has no `tags`
    // clause at all once dropped, so this rides along as its own AND branch
    // in both instead.
    const childrenFilter = isChildren
      ? { tags: { some: { name: CHILDREN_TAG_NAME } } }
      : { tags: { none: { name: CHILDREN_TAG_NAME } } };
    // PREMIUM_EXTRA and PREMIUM_CORE are independent flags — the early
    // return above only guards EXTRA (so price never needs gating past this
    // point), but an EXTRA-without-CORE user reaching here would otherwise
    // get densityStitches/densityRows back ungated. Same fix as
    // getPatterns/getPatternsByIds above.
    const core = hasCore(req);

    const fetchSimilar = (where: any) => prisma.pattern.findMany({
      where,
      take: SIMILAR_LIMIT,
      // publishedAt, not createdAt — see getPatterns' own comment.
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      omit: { images: true, details: true, ...(core ? {} : PATTERN_CORE_OMIT) },
      include: { author: true, instruments: true, categories: true, tags: true },
    });

    const baseWhere = { isVisible: true, id: { not: id } };
    let patterns: Awaited<ReturnType<typeof fetchSimilar>> = [];

    if (categoryIds.length > 0 && tagIds.length > 0) {
      patterns = await fetchSimilar({
        ...baseWhere,
        AND: [
          { categories: { some: { id: { in: categoryIds } } } },
          { tags: { some: { id: { in: tagIds } } } },
          childrenFilter,
        ],
      });
    }

    if (patterns.length < SIMILAR_MIN_RESULTS && categoryIds.length > 0) {
      patterns = await fetchSimilar({
        ...baseWhere,
        AND: [
          { categories: { some: { id: { in: categoryIds } } } },
          childrenFilter,
        ],
      });
    }

    res.json({ data: patterns.map(mapPatternListItem) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch similar patterns" });
  }
};
