export type PatternFacet = "categories" | "tags" | "instruments" | "authors" | "yarnRanges" | "density";

// Синтетический тег "взрослое". В БД его нет и заводить не нужно: у описаний
// проставляется только "детское", а взрослым считается всё остальное. Поэтому
// вместо реального тега используется id-заглушка, которую buildPatternWhere
// разворачивает в "нет тега детское", а getFilters подмешивает в список
// вариантов секции "Характеристики".
//
// Id намеренно не UUID — так он гарантированно не столкнётся с настоящим
// Tag.id и сразу виден в query-параметрах при отладке.
export const ADULT_TAG_ID = "adult";
export const ADULT_TAG_NAME = "взрослое";
// Сопоставление идёт по имени, а не по Tag.id: id одинаков на локальной и
// прод-базе сегодня, но имя переживёт пересоздание справочника. Обратная
// сторона — переименование тега в админке сломает фильтр, поэтому имя
// вынесено в константу, а не размазано по коду. Регистр не учитывается.
export const CHILDREN_TAG_NAME = "детское";

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
//
// Исключение — секция tags: она объединяется по И (см. ниже), и там
// самоисключение не применяется, иначе предлагались бы комбинации,
// заведомо дающие ноль. См. вызовы в filtersController.ts.
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
    // ЕДИНСТВЕННАЯ секция, где значения объединяются по И, а не по ИЛИ:
    // выбрать "ажуры" + "косы" значит "и с ажурами, и с косами". Остальные
    // секции остались на ИЛИ. Отсюда и отдельная сборка вместо общего
    // `some: { id: { in } }` — тот дал бы ИЛИ.
    //
    // Каждое значение становится своим условием в AND. "взрослое" — не тег,
    // а отрицание "детского", поэтому разворачивается в `none`, но участвует
    // в том же И: "взрослое" + "ажуры" = взрослое И с ажурами.
    const tagConditions = tagsParam.map((id) =>
      id === ADULT_TAG_ID
        ? { tags: { none: { name: { equals: CHILDREN_TAG_NAME, mode: "insensitive" } } } }
        : { tags: { some: { id } } }
    );

    where.AND = [...(where.AND || []), ...tagConditions];
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
