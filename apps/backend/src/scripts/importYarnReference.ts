/**
 * Этап 2 плана YARN_ARTICLES_PLAN.md — заливка справочника артикулов пряжи.
 *
 * Источник — `yarn_articles_reference.json` в корне репозитория, который
 * собирается из магазинных выгрузок скриптом data/yarn-articles/build_reference.py
 * (Этап 0). Здесь никакой логики разбора нет и быть не должно: заливаются
 * ровно те записи, что сборщик пометил `is_shop` или `is_generic`.
 *
 * Артикулы, выведенные из текстов описаний, НЕ заливаются — их 569, у них нет
 * карточки продавца, а у части ещё и чужие характеристики (все семь вариантов
 * Cardiff получили метраж одной реальной карточки). Они остаются в файле как
 * рабочий материал и попадут в БД только через PatternYarnMention.
 *
 * Идемпотентен: ключ — `normalizedKey`, повторный прогон обновляет карточку,
 * а не плодит дубли. Прогон с `--dry-run` ничего не пишет.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../prismaClient";
import { normalizeYarnKey, yarnDedupKey } from "../utils/yarnKeys";

interface RefRow {
  brand: string | null;
  name: string;
  line: string | null;
  aliases: string[];
  thickness_m_per_100g: number | null;
  composition: string | null;
  needle_size: string | null;
  needle_min_mm: number | null;
  needle_max_mm: number | null;
  density: string | null;
  density_stitches: number | null;
  density_rows: number | null;
  ball_weight_g: number | null;
  ball_length_m: number | null;
  source: string | null;
  source_url: string | null;
  is_shop: boolean;
  is_generic: boolean;
}

const REFERENCE_PATH = path.resolve(
  __dirname,
  "../../../../yarn_articles_reference.json",
);
const MERGED_PATH = path.resolve(
  __dirname,
  "../../../../yarn_articles_merged.json",
);

interface MergedRow {
  from: string;
  into: string;
  kind: string;
}

/**
 * Применить карту слияний из Этапа 0.
 *
 * Заливка выше умеет только добавлять и обновлять. Без этого шага карточка,
 * которую сборщик слил («Alize Angora Gold Batik» -> «Alize Angora Gold»),
 * остаётся в БД со своими связями: в справочнике её нет, а в продукте она
 * по-прежнему отдельная пряжа.
 *
 * Порядок важен — сначала переносим связи, потом удаляем карточку. Перенос
 * идёт сырым SQL, потому что на (patternId, yarnId) стоит уникальный индекс:
 * у описания уже может быть связь с родителем, и updateMany упал бы на первой
 * такой паре, оборвав весь прогон.
 *
 * Что теряется осознанно: если связь ребёнка была отвергнута модератором
 * (REJECTED), а связь родителя активна, после слияния останется активная.
 * Отказ относился к цветовому варианту, а не к самой пряже.
 */
async function applyMerges(dryRun: boolean) {
  if (!fs.existsSync(MERGED_PATH)) return;
  const merged: MergedRow[] = JSON.parse(fs.readFileSync(MERGED_PATH, "utf-8"));

  let done = 0;
  let movedLinks = 0;
  let movedMentions = 0;
  let absent = 0;
  let selfMerges = 0;
  const orphans: string[] = [];

  for (const m of merged) {
    const childKey = normalizeYarnKey(m.from);
    const parentKey = normalizeYarnKey(m.into);
    const child = await prisma.yarn.findUnique({
      where: { normalizedKey: childKey },
      select: { id: true },
    });
    if (!child) {
      absent++;
      continue;
    }
    const parent = await prisma.yarn.findUnique({
      where: { normalizedKey: parentKey },
      select: { id: true },
    });
    // Без адресата карточку не удаляем: это унесло бы связи в никуда.
    if (!parent) {
      orphans.push(`${m.from} -> ${m.into}`);
      continue;
    }
    // Ребёнок и родитель — одна строка: их имена дают один normalizedKey
    // («Камтекс Лен» и «Камтекс Лён» — транслитерация сводит «ё» к «e»).
    // Без этой проверки карточка находит сама себя и удаляется вместе со
    // своими связями. На проде так исчезли три штуки.
    if (parent.id === child.id) {
      selfMerges++;
      continue;
    }
    done++;
    if (dryRun) continue;

    movedLinks += await prisma.$executeRaw`
      UPDATE "PatternYarn" p SET "yarnId" = ${parent.id}
       WHERE p."yarnId" = ${child.id}
         AND NOT EXISTS (SELECT 1 FROM "PatternYarn" q
                          WHERE q."patternId" = p."patternId"
                            AND q."yarnId" = ${parent.id})`;
    // Осталось только то, что не переехало из-за уже существующей связи.
    await prisma.$executeRaw`DELETE FROM "PatternYarn" WHERE "yarnId" = ${child.id}`;

    movedMentions += await prisma.$executeRaw`
      UPDATE "PatternYarnMention" SET "suggestedYarnId" = ${parent.id}
       WHERE "suggestedYarnId" = ${child.id}`;

    await prisma.$executeRaw`DELETE FROM "YarnAlias" WHERE "yarnId" = ${child.id}`;
    await prisma.$executeRaw`DELETE FROM "Yarn" WHERE id = ${child.id}`;
  }

  console.log(
    dryRun
      ? `[dry-run] слилось бы карточек ${done} (нет в БД: ${absent})`
      : `слито карточек ${done}: связей перенесено ${movedLinks}, ` +
        `упоминаний ${movedMentions} (не было в БД: ${absent})`,
  );
  if (selfMerges) {
    console.warn(`строк карты, где ребёнок и родитель — одна карточка: ${selfMerges}`);
  }
  if (orphans.length) {
    console.warn(`слияний без адресата — карточки оставлены: ${orphans.length}`);
    orphans.slice(0, 10).forEach((o) => console.warn("  " + o));
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const all: RefRow[] = JSON.parse(fs.readFileSync(REFERENCE_PATH, "utf-8"));
  const rows = all.filter((r) => r.is_shop || r.is_generic);

  console.log(`справочник: ${all.length}, к заливке: ${rows.length}`);

  // Коллизия ключа означала бы, что одна из строк молча исчезнет при
  // заливке (normalizedKey уникален). Этап 0.6 должен был вычистить их все;
  // если хоть одна осталась — падаем до записи, а не после.
  const byKey = new Map<string, RefRow>();
  const collisions: string[] = [];
  for (const r of rows) {
    const k = normalizeYarnKey(r.name);
    const prev = byKey.get(k);
    if (prev) collisions.push(`${prev.name} <-> ${r.name} (${k})`);
    else byKey.set(k, r);
  }
  if (collisions.length) {
    console.error(`коллизии normalizedKey: ${collisions.length}`);
    collisions.slice(0, 20).forEach((c) => console.error("  " + c));
    process.exit(1);
  }

  // Что уже лежит в БД — одним запросом, а не по строке на карточку:
  // иначе на 2209 карточек уходит 2209 лишних round-trip'ов.
  const existing = new Set(
    (await prisma.yarn.findMany({ select: { normalizedKey: true } })).map(
      (y) => y.normalizedKey,
    ),
  );
  const takenAliases = new Set(
    (await prisma.yarnAlias.findMany({ select: { normalizedAlias: true } })).map(
      (a) => a.normalizedAlias,
    ),
  );

  let created = 0;
  let updated = 0;
  let aliasCount = 0;

  for (const r of rows) {
    const normalizedKey = normalizeYarnKey(r.name);
    const data = {
      brand: r.brand || null,
      line: r.line || null,
      name: r.name,
      dedupKey: yarnDedupKey(r.name),
      isGeneric: r.is_generic,
      mPer100g: r.thickness_m_per_100g,
      composition: r.composition,
      needleSizeRaw: r.needle_size,
      needleMinMm: r.needle_min_mm,
      needleMaxMm: r.needle_max_mm,
      densityRaw: r.density,
      densityStitches: r.density_stitches,
      densityRows: r.density_rows,
      ballWeightG: r.ball_weight_g,
      ballLengthM: r.ball_length_m,
      sourceName: r.source,
      sourceUrl: r.source_url,
    };

    existing.has(normalizedKey) ? updated++ : created++;

    const aliases = r.aliases
      .map((alias) => ({ alias, normalizedAlias: normalizeYarnKey(alias) }))
      .filter((a) => {
        // Псевдоним, совпавший с именем самой карточки, не нужен — он бы
        // дублировал normalizedKey. Одно написание, пришедшее от двух
        // карточек (цветовые варианты соседних линеек), достаётся первой:
        // normalizedAlias уникален.
        if (!a.normalizedAlias || a.normalizedAlias === normalizedKey) return false;
        if (takenAliases.has(a.normalizedAlias)) return false;
        takenAliases.add(a.normalizedAlias);
        return true;
      });
    aliasCount += aliases.length;

    if (dryRun) continue;

    const yarn = await prisma.yarn.upsert({
      where: { normalizedKey },
      create: { ...data, normalizedKey },
      update: data,
    });
    if (aliases.length) {
      await prisma.yarnAlias.createMany({
        data: aliases.map((a) => ({ ...a, yarnId: yarn.id })),
        skipDuplicates: true,
      });
    }
  }

  await applyMerges(dryRun);

  console.log(
    dryRun
      ? `[dry-run] создалось бы ${created}, обновилось бы ${updated}, псевдонимов ${aliasCount}`
      : `создано ${created}, обновлено ${updated}, псевдонимов ${aliasCount}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
