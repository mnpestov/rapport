import { Pattern, FilterOption, FiltersResponse } from '../api/patternsApi';
import { SelectedFilters } from '../components/FilterModal/FilterModal';
import { SortOption } from '../components/SortModal/SortModal';
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

// Зеркало ADULT_TAG_ID/ADULT_TAG_NAME/CHILDREN_TAG_NAME из бэкендового
// patternFilters.ts. Продублировано, а не импортировано: фронтенд и бэкенд —
// отдельные пакеты без общего модуля. При переименовании тега "детское"
// править нужно оба места.
const ADULT_TAG_ID = 'adult';
const ADULT_TAG_NAME = 'взрослое';
const CHILDREN_TAG_NAME = 'детское';

const idsIntersect = (patternIds: string[] | undefined, selectedIds: string[]): boolean => {
  if (selectedIds.length === 0) return true;
  if (!patternIds || patternIds.length === 0) return false;
  return patternIds.some(id => selectedIds.includes(id));
};

const isAdultPattern = (pattern: Pattern): boolean =>
  !(pattern.tags || []).some(n => n.toLowerCase() === CHILDREN_TAG_NAME);

// Секция тегов отличается от остальных дважды: значения объединяются по И
// (а не по ИЛИ, как везде), и одно из значений — отрицание ("взрослое" =
// нет тега "детское"). Поэтому у неё свой матчер вместо общего
// idsIntersect. Зеркалит ветку tags в buildPatternWhere на бэкенде.
const matchesTags = (pattern: Pattern, selectedTags: string[]): boolean =>
  selectedTags.every(id =>
    id === ADULT_TAG_ID
      ? isAdultPattern(pattern)
      : (pattern.tagIds || []).includes(id)
  );

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
  if (excludeFacet !== 'tags' && !matchesTags(pattern, selected.tags)) return false;
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

// priceMin/priceMax live on `selected` itself (SelectedFilters), not a
// top-level ClientFilterOptions field like isDiscount — they're plain
// strings straight off the two range inputs, not a facet id-list, so there's
// nothing for matchesFacetsExcept to do with them; checked directly here
// instead, mirroring how getPatterns merges them into `where.price`
// server-side. Patterns with no price at all (non-extra — never reached
// here, since FilterModal hides the "Цена" section for them — or genuinely
// priceless) fail a bound that's actually set, same as the server's
// `where.price` would exclude a NULL row from a `gte`/`lte` comparison.
const matchesPriceRange = (p: Pattern, priceMin: string, priceMax: string): boolean => {
  if (!priceMin && !priceMax) return true;
  const price = p.price != null ? parseFloat(p.price) : null;
  if (price == null) return false;
  if (priceMin && price < parseFloat(priceMin)) return false;
  if (priceMax && price > parseFloat(priceMax)) return false;
  return true;
};

export const filterPatterns = (patterns: Pattern[], opts: ClientFilterOptions): Pattern[] => {
  return patterns.filter(p => {
    if (opts.isFree && !p.isFree) return false;
    if (opts.isNew && !p.isNew) return false;
    if (opts.isDiscount && !hasActiveDiscount(p)) return false;
    if (!matchesPriceRange(p, opts.selected.priceMin, opts.selected.priceMax)) return false;
    if (!matchesSearch(p, opts.search)) return false;
    return matchesFacetsExcept(p, opts.selected);
  });
};

// Mirrors getPatterns' own orderBy (patternsController.ts) — 'newest' by
// publishedAt desc, price_asc/price_desc with NULLs (free items — always
// NULL, never 0, verified live) pushed to the end regardless of direction,
// same as the server's `nulls: 'last'`. id is the tie-breaker everywhere,
// matching the server's own `{ id: 'asc' }` secondary sort, even though a
// client-side full-array sort has no pagination-duplicate risk to guard
// against — kept for behavioral consistency between catalog and favorites.
// Favorites' SortModal already hides price_asc/price_desc for non-extra
// users (see SortModal.tsx), so this never needs its own extra check.
export const sortPatterns = (patterns: Pattern[], sort: SortOption): Pattern[] => {
  if (sort === 'newest') {
    return [...patterns].sort((a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() || a.id.localeCompare(b.id)
    );
  }
  // Популярность — по тому же popularityScore, по которому сортируется
  // каталог; здесь он приезжает в самих описаниях. Запасные ключи те же и в
  // том же порядке, что у сервера (publishedAt, затем id): у описаний без
  // открытий балл одинаковый, и без них порядок разошёлся бы с каталогом.
  if (sort === 'popular') {
    return [...patterns].sort((a, b) =>
      (b.popularityScore ?? 0) - (a.popularityScore ?? 0) ||
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() ||
      a.id.localeCompare(b.id)
    );
  }
  const dir = sort === 'price_asc' ? 1 : -1;
  return [...patterns].sort((a, b) => {
    const pa = a.price != null ? parseFloat(a.price) : null;
    const pb = b.price != null ? parseFloat(b.price) : null;
    if (pa == null && pb == null) return a.id.localeCompare(b.id);
    if (pa == null) return 1;
    if (pb == null) return -1;
    return (pa - pb) * dir || a.id.localeCompare(b.id);
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
  // Без исключения собственной секции, в отличие от остальных: теги
  // объединяются по И, поэтому список должен сужаться по мере выбора —
  // иначе предлагались бы теги, дающие в паре с уже выбранным ноль.
  // Зеркалит вызовы без excludeFacet в filtersController.ts.
  const tagsFromPatterns = collectUnique(
    patterns,
    p => matchesFacetsExcept(p, selected),
    p => zip(p.tagIds, p.tags)
  );
  // Как и на бэкенде: вариант "взрослое" появляется, только если под него
  // реально что-то подпадает при остальных фильтрах.
  const hasAdult = patterns.some(
    p => matchesFacetsExcept(p, selected) && isAdultPattern(p)
  );
  const tags = hasAdult
    ? [...tagsFromPatterns, { id: ADULT_TAG_ID, name: ADULT_TAG_NAME }]
    : tagsFromPatterns;
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
