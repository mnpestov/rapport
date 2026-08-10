import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { buildPatternWhere, stripPremiumFacetParams } from "../utils/patternFilters";
import { hasCore } from "../utils/patternVisibility";

// Accepts the same facet query params as /patterns (categories, tags,
// instruments, authors, yarnRanges, density). Each section's option list is
// scoped to patterns matching every OTHER currently selected facet — so
// selecting a category narrows the density options to only those that occur
// on patterns in that category, and vice versa (faceted/cascading filters).
// A facet never narrows its own section (see buildPatternWhere's
// excludeFacet) — values within one section are OR'd, not AND'd, so checking
// one density option must not immediately hide its siblings.
export const getFilters = async (req: Request, res: Response) => {
  try {
    // yarnRanges/density are PREMIUM_CORE-gated facets — strip the params
    // before they ever reach buildPatternWhere (single interception point,
    // see PAID_TIER_PERMISSIONS_PLAN.md §3.3), and skip their own facet
    // queries entirely for !core rather than compute and then discard them
    // (same "don't bother hitting the DB" reasoning as getSimilarPatterns
    // for PREMIUM_EXTRA in patternsController.ts).
    const core = hasCore(req);
    const query = stripPremiumFacetParams(req.query, core);

    const [categories, tags, instruments, authors, yarnRangesRaw, densityRaw] = await Promise.all([
      prisma.productType.findMany({
        where: { patterns: { some: buildPatternWhere(query, "categories") } },
        select: { id: true, name: true },
      }),
      prisma.tag.findMany({
        where: { patterns: { some: buildPatternWhere(query, "tags") } },
        select: { id: true, name: true },
      }),
      prisma.instrument.findMany({
        where: { patterns: { some: buildPatternWhere(query, "instruments") } },
        select: { id: true, name: true },
      }),
      prisma.author.findMany({
        where: { patterns: { some: buildPatternWhere(query, "authors") } },
        select: { id: true, name: true },
      }),
      core
        ? prisma.yarnRange.findMany({
            where: { patterns: { some: buildPatternWhere(query, "yarnRanges") } },
            orderBy: { sortOrder: "asc" },
            select: { id: true, label: true },
          })
        : Promise.resolve([]),
      // Unlike the lookup tables above, there is no Density dictionary model —
      // density is just two Decimal columns on Pattern — so the filter's
      // option list is derived from the distinct combinations actually used
      // by patterns matching every other selected facet.
      core
        ? prisma.pattern.findMany({
            where: {
              ...buildPatternWhere(query, "density"),
              densityStitches: { not: null },
              densityRows: { not: null },
            },
            select: { densityStitches: true, densityRows: true },
            distinct: ["densityStitches", "densityRows"],
          })
        : Promise.resolve([]),
    ]);

    const yarnRanges = yarnRangesRaw.map((y) => ({ id: y.id, name: y.label }));

    const density = densityRaw
      .map((p) => ({ stitches: p.densityStitches!.toNumber(), rows: p.densityRows!.toNumber() }))
      .sort((a, b) => a.stitches - b.stitches || a.rows - b.rows)
      .map(({ stitches, rows }) => ({ id: `${stitches}x${rows}`, name: `${stitches} п. × ${rows} р.` }));

    res.json({
      categories,
      tags,
      instruments,
      authors,
      yarnRanges,
      density,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch filters" });
  }
};
