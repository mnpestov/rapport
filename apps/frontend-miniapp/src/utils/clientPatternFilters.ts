import { Pattern, FilterOption, FiltersResponse } from '../api/patternsApi';
import { SelectedFilters } from '../components/FilterModal/FilterModal';
import { hasActiveDiscount } from './priceHelpers';

// Client-side equivalent of the backend's buildPatternWhere/getFilters
// (patternFilters.ts, filtersController.ts) — used by the favorites page,
// which loads its whole (bounded) pattern set up front and then
// searches/filters entirely in the browser rather than round-tripping to
// the server per keystroke/filter change like the catalog does. Kept in
// lockstep with the backend's matching rules by design: within one facet
// section values are OR'd, across sections AND'd, self-exclusion when
// computing a section's own available options.

type PatternFacet = keyof SelectedFilters;

const idsIntersect = (patternIds: string[] | undefined, selectedIds: string[]): boolean => {
  if (selectedIds.length === 0) return true;
  if (!patternIds || patternIds.length === 0) return false;
  return patternIds.some(id => selectedIds.includes(id));
};

const matchesDensity = (pattern: Pattern, selectedKeys: string[]): boolean => {
  if (selectedKeys.length === 0) return true;
  if (pattern.densityStitches == null || pattern.densityRows == null) return false;
  const stitches = Number(pattern.densityStitches);
  const rows = Number(pattern.densityRows);
  return selectedKeys.some(key => {
    const [s, r] = key.split('x').map(Number);
    return stitches === s && rows === r;
  });
};

// Mirrors buildPatternWhere(query, excludeFacet) — checks every facet
// EXCEPT excludeFacet (used when computing that facet's own option list, so
// picking a value never prunes its own section's siblings).
export const matchesFacetsExcept = (
  pattern: Pattern,
  selected: SelectedFilters,
  excludeFacet?: PatternFacet
): boolean => {
  if (excludeFacet !== 'categories' && !idsIntersect(pattern.categoryIds, selected.categories)) return false;
  if (excludeFacet !== 'tags' && !idsIntersect(pattern.tagIds, selected.tags)) return false;
  if (excludeFacet !== 'instruments' && !idsIntersect(pattern.instrumentIds, selected.instruments)) return false;
  if (excludeFacet !== 'authors' && selected.authors.length > 0 && !selected.authors.includes(pattern.authorId)) return false;
  if (excludeFacet !== 'yarnRanges' && !idsIntersect(pattern.yarnRangeIds, selected.yarnRanges)) return false;
  if (excludeFacet !== 'density' && !matchesDensity(pattern, selected.density)) return false;
  return true;
};

// Mirrors getPatterns' `search` OR-clause (title/author/categories/
// instruments/tags, case-insensitive substring).
export const matchesSearch = (pattern: Pattern, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (pattern.title.toLowerCase().includes(q)) return true;
  if (pattern.author.toLowerCase().includes(q)) return true;
  if (pattern.productTypes.some(n => n.toLowerCase().includes(q))) return true;
  if (pattern.instruments.some(n => n.toLowerCase().includes(q))) return true;
  if (pattern.tags.some(n => n.toLowerCase().includes(q))) return true;
  return false;
};

export interface ClientFilterOptions {
  search: string;
  isFree: boolean;
  isNew: boolean;
  // Only ever meaningfully true for PREMIUM_EXTRA users — non-extra
  // Pattern objects never carry price/oldPrice at all (see Pattern's own
  // comment in patternsApi.ts), so hasActiveDiscount is always false for
  // them regardless of this flag. SearchFilterBar itself hides the chip
  // for non-extra users, so this mirrors what's actually reachable.
  isDiscount: boolean;
  selected: SelectedFilters;
}

export const filterPatterns = (patterns: Pattern[], opts: ClientFilterOptions): Pattern[] => {
  return patterns.filter(p => {
    if (opts.isFree && !p.isFree) return false;
    if (opts.isNew && !p.isNew) return false;
    if (opts.isDiscount && !hasActiveDiscount(p)) return false;
    if (!matchesSearch(p, opts.search)) return false;
    return matchesFacetsExcept(p, opts.selected);
  });
};

const zip = (ids: string[] | undefined, names: string[] | undefined): FilterOption[] => {
  if (!ids || !names) return [];
  return ids.map((id, i) => ({ id, name: names[i] })).filter(o => o.name !== undefined);
};

const collectUnique = (patterns: Pattern[], predicate: (p: Pattern) => boolean, extract: (p: Pattern) => FilterOption[]): FilterOption[] => {
  const byId = new Map<string, string>();
  for (const p of patterns) {
    if (!predicate(p)) continue;
    for (const { id, name } of extract(p)) {
      if (!byId.has(id)) byId.set(id, name);
    }
  }
  return Array.from(byId, ([id, name]) => ({ id, name }));
};

// The yarnRanges facet needs a label per id, and Pattern only ever carries
// yarnRangeIds (no parallel label array, unlike categories/tags/instruments)
// — see patternsApi.ts's Pattern.yarnRangeIds comment. `yarnRangesUniverse`
// is the full {id,label} list from one unfiltered fetchFilters() call,
// fetched once by the favorites page purely as a name+sortOrder reference,
// never as the option SOURCE itself (that's still computed from favorites
// below, same as every other section).
export const computeFacetsFromPatterns = (
  patterns: Pattern[],
  selected: SelectedFilters,
  yarnRangesUniverse: FilterOption[]
): FiltersResponse => {
  const categories = collectUnique(
    patterns,
    p => matchesFacetsExcept(p, selected, 'categories'),
    p => zip(p.categoryIds, p.productTypes)
  );
  const tags = collectUnique(
    patterns,
    p => matchesFacetsExcept(p, selected, 'tags'),
    p => zip(p.tagIds, p.tags)
  );
  const instruments = collectUnique(
    patterns,
    p => matchesFacetsExcept(p, selected, 'instruments'),
    p => zip(p.instrumentIds, p.instruments)
  );
  const authors = collectUnique(
    patterns,
    p => matchesFacetsExcept(p, selected, 'authors'),
    p => [{ id: p.authorId, name: p.author }]
  );

  const yarnRangeIdsPresent = new Set(
    collectUnique(
      patterns,
      p => matchesFacetsExcept(p, selected, 'yarnRanges'),
      p => (p.yarnRangeIds || []).map(id => ({ id, name: id }))
    ).map(o => o.id)
  );
  // Reordered to match yarnRangesUniverse's own order (backend's
  // sortOrder), not Map-insertion/iteration order — FilterModal doesn't
  // alphabetically re-sort this section (see its renderSection comment),
  // it trusts the source to already be in display order.
  const yarnRanges = yarnRangesUniverse.filter(o => yarnRangeIdsPresent.has(o.id));

  const densityPairs = collectUnique(
    patterns,
    p => matchesFacetsExcept(p, selected, 'density'),
    p => (p.densityStitches != null && p.densityRows != null)
      ? [{ id: `${p.densityStitches}x${p.densityRows}`, name: `${p.densityStitches} п. × ${p.densityRows} р.` }]
      : []
  );
  const density = densityPairs.sort((a, b) => {
    const [aS, aR] = a.id.split('x').map(Number);
    const [bS, bR] = b.id.split('x').map(Number);
    return aS - bS || aR - bR;
  });

  return { categories, tags, instruments, authors, yarnRanges, density };
};
