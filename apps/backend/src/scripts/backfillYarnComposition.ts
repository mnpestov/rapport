/**
 * Одноразовая заливка справочника волокон (FiberType) и разбор
 * существующих Yarn.composition на структурированные YarnComposition.
 *
 * Источник словаря — fiberTypeDictionary.json (сгенерирован offline
 * Python-скриптом из разбора 3141 значения composition на проде, сентябрь
 * 2026): 121 каноническое волокно + словарь "сырое написание -> канон",
 * собранный вручную с проверкой неоднозначных случаев.
 *
 * Что скрипт делает:
 *   1. Заливает/обновляет FiberType по displayName (идемпотентно).
 *   2. Для каждого Yarn с непустым composition разбирает текст на
 *      компоненты (fiberComposition.ts), матчит каждое сырое название по
 *      словарю rawToCanon (точное совпадение после trim+lowercase — НЕ
 *      эвристика, чтобы не приписать волокно, которого словарь не видел).
 *   3. Создаёт YarnComposition только для того, что распознано. Всё
 *      остальное (новые формулировки, которых не было в исходных 3141
 *      строках) остаётся неразобранным — Yarn.composition при этом не
 *      трогается, админ дозаполнит вручную через форму одобрения.
 *
 * Идемпотентен: FiberType.displayName уникален, YarnComposition уникален
 * по (yarnId, fiberTypeId) — повторный прогон не плодит дубли.
 * Прогон с --dry-run ничего не пишет.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../prismaClient";
import { parseCompositionLine } from "../utils/fiberComposition";

interface FiberTypeSeed {
  displayName: string;
  baseFiber: string;
  subtype: string | null;
  grade: string | null;
  treatment: string | null;
  origin: string | null;
  sortOrder: number;
}

interface Dictionary {
  fiberTypes: FiberTypeSeed[];
  rawToCanon: Record<string, string>;
}

const DICTIONARY_PATH = path.resolve(__dirname, "../data/fiberTypeDictionary.json");

async function seedFiberTypes(dictionary: Dictionary, dryRun: boolean): Promise<Map<string, string>> {
  const existing = await prisma.fiberType.findMany({ select: { id: true, displayName: true } });
  const byName = new Map(existing.map((f) => [f.displayName, f.id]));

  let created = 0;
  let updated = 0;

  for (const seed of dictionary.fiberTypes) {
    byName.has(seed.displayName) ? updated++ : created++;
    if (dryRun) {
      // Placeholder-id, чтобы backfillCompositions ниже могла посчитать
      // статистику совпадений без реальной записи в БД — иначе матчинг
      // по fiberTypeIdByName.get(canon) вернул бы undefined для каждого
      // ещё не существующего волокна, и dry-run всегда показывал бы 0
      // разобранных строк.
      byName.set(seed.displayName, byName.get(seed.displayName) ?? `dry-run:${seed.displayName}`);
      continue;
    }

    const row = await prisma.fiberType.upsert({
      where: { displayName: seed.displayName },
      create: seed,
      update: seed,
      select: { id: true, displayName: true },
    });
    byName.set(row.displayName, row.id);
  }

  console.log(
    dryRun
      ? `[dry-run] FiberType: создалось бы ${created}, обновилось бы ${updated}`
      : `FiberType: создано ${created}, обновлено ${updated}`,
  );
  return byName;
}

async function backfillCompositions(
  dictionary: Dictionary,
  fiberTypeIdByName: Map<string, string>,
  dryRun: boolean,
) {
  const yarns = await prisma.yarn.findMany({
    where: { composition: { not: null } },
    select: { id: true, composition: true },
  });

  let yarnsFullyParsed = 0;
  let yarnsPartiallyParsed = 0;
  let yarnsUnparsed = 0;
  let componentsCreated = 0;
  const unmatchedRawNames = new Map<string, number>();

  for (const yarn of yarns) {
    // Точечный фикс опечатки в исходных данных прод-справочника: "18
    // полиамид" без "%" — без этого число "18" слипается с соседним
    // "альпака" в один компонент ("альпака 18 полиамид").
    const composition = yarn.composition!.replace(
      "10% альпака, 18 полиамид, 10% меринос",
      "10% альпака, 18% полиамид, 10% меринос",
    );
    const components = parseCompositionLine(composition);
    if (components.length === 0) {
      yarnsUnparsed++;
      continue;
    }

    const rows: { fiberTypeId: string; percentage: number | null }[] = [];
    let matchedCount = 0;

    for (const { rawName, percentage } of components) {
      const key = rawName.trim().toLowerCase();
      const canon = dictionary.rawToCanon[key];
      if (!canon) {
        unmatchedRawNames.set(key, (unmatchedRawNames.get(key) ?? 0) + 1);
        continue;
      }
      const fiberTypeId = fiberTypeIdByName.get(canon);
      if (!fiberTypeId) continue; // не должно случиться, но не роняем прогон
      matchedCount++;
      rows.push({ fiberTypeId, percentage });
    }

    if (matchedCount === 0) {
      yarnsUnparsed++;
      continue;
    }
    if (matchedCount < components.length) {
      yarnsPartiallyParsed++;
    } else {
      yarnsFullyParsed++;
    }

    if (dryRun) {
      componentsCreated += rows.length;
      continue;
    }

    for (const row of rows) {
      await prisma.yarnComposition.upsert({
        where: { yarnId_fiberTypeId: { yarnId: yarn.id, fiberTypeId: row.fiberTypeId } },
        create: { yarnId: yarn.id, fiberTypeId: row.fiberTypeId, percentage: row.percentage },
        update: { percentage: row.percentage },
      });
      componentsCreated++;
    }
  }

  console.log(
    (dryRun ? "[dry-run] " : "") +
      `Yarn с composition: ${yarns.length}, полностью разобрано: ${yarnsFullyParsed}, ` +
      `частично: ${yarnsPartiallyParsed}, не разобрано вовсе: ${yarnsUnparsed}, ` +
      `строк YarnComposition ${dryRun ? "создалось бы" : "создано/обновлено"}: ${componentsCreated}`,
  );

  if (unmatchedRawNames.size > 0) {
    const top = [...unmatchedRawNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    console.warn(`нераспознанных сырых названий волокна (уникальных): ${unmatchedRawNames.size}`);
    top.forEach(([name, count]) => console.warn(`  ${count}\t${name}`));
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dictionary: Dictionary = JSON.parse(fs.readFileSync(DICTIONARY_PATH, "utf-8"));

  console.log(`словарь: ${dictionary.fiberTypes.length} волокон, ${Object.keys(dictionary.rawToCanon).length} сырых написаний`);

  const fiberTypeIdByName = await seedFiberTypes(dictionary, dryRun);
  await backfillCompositions(dictionary, fiberTypeIdByName, dryRun);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
