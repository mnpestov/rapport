/**
 * Наблюдаемость по артикулам пряжи — Этап 6 плана YARN_ARTICLES_PLAN.md.
 *
 * Считается сырым SQL, а не набором prisma-запросов: это семь агрегатов по
 * трём таблицам, и через ORM они превратились бы в семь round-trip'ов ради
 * одного виджета. Периода у виджета нет намеренно — это состояние
 * справочника и связей на сейчас, а не поток событий.
 */
import { Request, Response } from "express";
import { prisma } from "../prismaClient";

interface Counts {
  patternsWithDetails: number;
  patternsWithYarn: number;
  links: number;
  linksByRule: { rule: string; count: number }[];
  mentionsByKind: { kind: string; count: number }[];
  genericLinks: { name: string; count: number }[];
  staleLinks: number;
  brandLevelNoLongerPassing: number;
  topUnresolved: { rawText: string; kind: string; count: number }[];
}

export async function getYarnStats(_req: Request, res: Response) {
  const [
    patternsWithDetails,
    patternsWithYarn,
    links,
    linksByRule,
    mentionsByKind,
    genericLinks,
    staleLinks,
    brandLevelNoLongerPassing,
    topUnresolved,
  ] = await Promise.all([
    prisma.pattern.count({ where: { details: { not: null } } }),
    prisma.patternYarn
      .findMany({ where: { status: "ACTIVE" }, select: { patternId: true }, distinct: ["patternId"] })
      .then((r) => r.length),
    prisma.patternYarn.count({ where: { status: "ACTIVE" } }),

    prisma.$queryRaw<{ rule: string; count: bigint }[]>`
      SELECT COALESCE("matchRule"::text, 'без правила') AS rule, count(*) AS count
        FROM "PatternYarn" WHERE status = 'ACTIVE'
       GROUP BY 1 ORDER BY 2 DESC`,

    prisma.$queryRaw<{ kind: string; count: bigint }[]>`
      SELECT kind::text AS kind, count(*) AS count
        FROM "PatternYarnMention" WHERE status = 'PENDING'
       GROUP BY 1 ORDER BY 2 DESC`,

    // Родовое правило — самое широкое из восьми и единственное, что
    // срабатывает на обиходном слове, а не на названии товара. Резкий рост
    // здесь означает, что оно начало хватать лишнее.
    prisma.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT y.name, count(*) AS count
        FROM "PatternYarn" py JOIN "Yarn" y ON y.id = py."yarnId"
       WHERE py.status = 'ACTIVE' AND y."isGeneric"
       GROUP BY 1 ORDER BY 2 DESC`,

    // Связь собрана не с того текста, что лежит в описании сейчас: правка
    // details в админке связи не трогает, и заметить расхождение больше
    // негде.
    //
    // convert_to(..., 'UTF8'), а не ::bytea: приведение к bytea ждёт
    // экранированную строку и на обычном тексте падает. Отпечаток должен
    // совпасть с питоновским sha256(text.encode('utf-8')).hexdigest()[:16]
    // из yarn_lib/analyze.py — там же его пишет бэкофил.
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
        FROM "PatternYarn" py JOIN "Pattern" p ON p.id = py."patternId"
       WHERE py.status = 'ACTIVE' AND py."detailsHash" IS NOT NULL
         AND py."detailsHash" <> substr(
               encode(sha256(convert_to(COALESCE(p.details, ''), 'UTF8')), 'hex'), 1, 16)`,

    // Связи уровня бренда, у которых марка больше не проходит собственное
    // условие «все карточки с одинаковым непустым метражом»: справочник
    // пополнили, у бренда появилась линейка с другим метражом — и связь
    // осталась висеть по правилу, которое сейчас не сработало бы.
    // Родовые карточки исключены: они это условие проходят по построению и
    // принадлежат другому правилу.
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
        FROM "PatternYarn" py
        JOIN "Yarn" y ON y.id = py."yarnId"
       WHERE py.status = 'ACTIVE' AND py."matchRule" = 'BRAND_LEVEL'
         AND NOT y."isGeneric"
         AND y.brand IS NOT NULL
         AND (SELECT count(DISTINCT COALESCE(b."mPer100g", -1))
                FROM "Yarn" b
               WHERE b.brand = y.brand AND NOT b."isGeneric"
                 AND b."isActive" AND b."mergedIntoId" IS NULL) > 1`,

    // Рабочий список на пополнение справочника: чего авторы просят чаще
    // всего, а карточки нет.
    prisma.$queryRaw<{ rawText: string; kind: string; count: bigint }[]>`
      SELECT "rawText", kind::text AS kind, count(*) AS count
        FROM "PatternYarnMention" WHERE status = 'PENDING'
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`,
  ]);

  const n = (v: bigint | number) => Number(v);
  const out: Counts = {
    patternsWithDetails,
    patternsWithYarn,
    links,
    linksByRule: linksByRule.map((r) => ({ rule: r.rule, count: n(r.count) })),
    mentionsByKind: mentionsByKind.map((r) => ({ kind: r.kind, count: n(r.count) })),
    genericLinks: genericLinks.map((r) => ({ name: r.name, count: n(r.count) })),
    staleLinks: n(staleLinks[0]?.count ?? 0),
    brandLevelNoLongerPassing: n(brandLevelNoLongerPassing[0]?.count ?? 0),
    topUnresolved: topUnresolved.map((r) => ({ rawText: r.rawText, kind: r.kind, count: n(r.count) })),
  };
  res.json(out);
}
