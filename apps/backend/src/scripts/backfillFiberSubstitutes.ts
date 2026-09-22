/**
 * Одноразовая заливка таблицы заменителей волокон (FiberSubstitute) из
 * fiberSubstituteDictionary.json — перенос экспертной матрицы совместимости
 * (rapport_fiber_substitutes.md, сентябрь 2026) в БД. Уровень (A/B/C/X)
 * согласован на реальном примере (Persiano 45% беби-альпака + 25% меринос
 * + 30% нейлон против описания на 100% мериноса) — допуски скоринга
 * компонуются отдельно, эта таблица только "какое волокно вообще может
 * заменять какое и с какой ролью" (material/functional/visual/decorative).
 *
 * Идемпотентен: @@unique([source, target]) — повторный прогон обновляет
 * строки, не плодит дубли. --dry-run ничего не пишет.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../prismaClient";
import { FiberSubstituteLevel, FiberSubstituteRole } from "@prisma/client";

interface SubstituteSeed {
  source: string;
  target: string;
  level: "A" | "B" | "C" | "X";
  role: "material" | "functional" | "visual" | "decorative";
  symmetric: boolean;
}

const ROLE_MAP: Record<SubstituteSeed["role"], FiberSubstituteRole> = {
  material: FiberSubstituteRole.MATERIAL,
  functional: FiberSubstituteRole.FUNCTIONAL,
  visual: FiberSubstituteRole.VISUAL,
  decorative: FiberSubstituteRole.DECORATIVE,
};

const DICTIONARY_PATH = path.resolve(__dirname, "../data/fiberSubstituteDictionary.json");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const seeds: SubstituteSeed[] = JSON.parse(fs.readFileSync(DICTIONARY_PATH, "utf-8"));

  console.log(`словарь заменителей: ${seeds.length} пар`);

  const existing = await prisma.fiberSubstitute.findMany({ select: { source: true, target: true } });
  const existingKeys = new Set(existing.map((r) => `${r.source}\u0000${r.target}`));

  let created = 0;
  let updated = 0;

  for (const seed of seeds) {
    const key = `${seed.source}\u0000${seed.target}`;
    existingKeys.has(key) ? updated++ : created++;
    if (dryRun) continue;

    await prisma.fiberSubstitute.upsert({
      where: { source_target: { source: seed.source, target: seed.target } },
      create: {
        source: seed.source,
        target: seed.target,
        level: seed.level as FiberSubstituteLevel,
        role: ROLE_MAP[seed.role],
        symmetric: seed.symmetric,
      },
      update: {
        level: seed.level as FiberSubstituteLevel,
        role: ROLE_MAP[seed.role],
        symmetric: seed.symmetric,
      },
    });
  }

  console.log(
    dryRun
      ? `[dry-run] FiberSubstitute: создалось бы ${created}, обновилось бы ${updated}`
      : `FiberSubstitute: создано ${created}, обновлено ${updated}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
