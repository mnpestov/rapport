export type PatternFacet = "categories" | "tags" | "instruments" | "authors" | "yarnRanges" | "density";

// Single interception point for the PREMIUM_CORE gate (yarnRanges/density
// are the two facets it covers) — called once at the top of getPatterns/
// getFilters, before query ever reaches buildPatternWhere (which stays a
// pure function with no access to req/role). Keeps the gate to 2 call sites
// instead of threading a role param through all 6 buildPatternWhere calls.
// See PAID_TIER_PERMISSIONS_PLAN.md §3.3.
export const stripPremiumFacetParams = (
  query: Record<string, unknown>,
  hasCore: boolean
): Record<string, unknown> => {
  if (hasCore) return query;
  const { yarnRanges, density, ...rest } = query;
  return rest;
};

export const parseArrayParam = (param: unknown): string[] => {
  if (!param) return [];
  if (Array.isArray(param)) return param as string[];
  if (typeof param === "string") return param.split(",");
  return [];
};

// Shared by /patterns and /filters. `excludeFacet` omits that one facet's own
// condition — /filters uses this to compute each section's available options
// against every OTHER selected facet, so picking a value never prunes its own
// section's siblings (values within a section are OR'd, not AND'd).
export const buildPatternWhere = (query: Record<string, unknown>, excludeFacet?: PatternFacet): any => {
  const where: any = { isVisible: true };

  const categoriesParam = parseArrayParam(query.categories);
  const tagsParam = parseArrayParam(query.tags);
  const instrumentsParam = parseArrayParam(query.instruments);
  const authorsParam = parseArrayParam(query.authors);
  const yarnRangesParam = parseArrayParam(query.yarnRanges);
  const densityParam = parseArrayParam(query.density);

  if (excludeFacet !== "categories" && categoriesParam.length > 0) {
    where.categories = { some: { id: { in: categoriesParam } } };
  }

  if (excludeFacet !== "tags" && tagsParam.length > 0) {
    where.tags = { some: { id: { in: tagsParam } } };
  }

  if (excludeFacet !== "instruments" && instrumentsParam.length > 0) {
    where.instruments = { some: { id: { in: instrumentsParam } } };
  }

  if (excludeFacet !== "authors" && authorsParam.length > 0) {
    where.authorId = { in: authorsParam };
  }

  if (excludeFacet !== "yarnRanges" && yarnRangesParam.length > 0) {
    where.yarnRanges = { some: { id: { in: yarnRangesParam } } };
  }

  if (excludeFacet !== "density" && densityParam.length > 0) {
    const densityOr = densityParam
      .map((key) => {
        const [stitches, rows] = key.split("x").map(Number);
        return { densityStitches: stitches, densityRows: rows };
      })
      .filter((pair) => !Number.isNaN(pair.densityStitches) && !Number.isNaN(pair.densityRows));

    if (densityOr.length > 0) {
      where.AND = [...(where.AND || []), { OR: densityOr }];
    }
  }

  return where;
};
