/**
 * Разовый бэкфил Yarn.line для записей, созданных до того, как все пути
 * создания артикула (хранилище пряжи, оба Ravelry-импорта) стали заполнять
 * его сами — см. yarnNaming.ts и анализ в чате, октябрь 2026. Раньше line
 * оставался null, а line/бренд были либо склеены в name целиком (если
 * пользователь сам вписал бренд в поле "Артикул"), либо бренд вовсе не
 * попадал в name — отсюда два симптома: карточка без бренда в названии и
 * форма редактирования с пустым полем "Артикул" при непустом name.
 *
 * Логика на каждую строку с line IS NULL и непустым brand:
 *   0. Если name совпадает с brand один-в-один (без учёта регистра) —
 *      отдельной линейки в принципе нет, делить нечего. Строка пропускается
 *      (не трогаем ни name, ни line) и попадает в отчёт "неоднозначно" —
 *      решение, что туда писать (пусто? имя бренда ещё раз?), оставляем
 *      модератору, а не угадываем.
 *   1. Если name начинается с brand целым словом (stripBrandPrefix его
 *      находит) ИЛИ brand вообще где-то встречается внутри name (не
 *      обязательно в начале) — name уже отражает бренд, трогать его не
 *      нужно: просто заполняем line (остаток после бренда, если он был
 *      префиксом, иначе всё текущее name целиком).
 *   2. Иначе бренда в name нет вовсе — line становится текущим name
 *      (больше неоткуда его взять), а новое name пересобирается как
 *      brand+line (composeYarnName), то есть бренд ДОПИСЫВАЕТСЯ спереди.
 *      Это меняет видимое название артикула в общем справочнике — решение
 *      согласовано явно (вариант 1-3, чат с пользователем, октябрь 2026).
 *      StashSkein.*Snapshot уже скопированы на момент создания мотка и не
 *      читают Yarn.name заново, так что уже созданные мотки пользователей
 *      эту правку не увидят — меняется только карточка в справочнике.
 *
 * При пересборке name меняется normalizedKey/dedupKey — если из-за этого
 * ключ совпал с ДРУГИМ существующим артикулом (двойник, который различался
 * только наличием бренда в названии), строка пропускается и логируется для
 * ручного слияния через существующий инструмент "Слить с существующим" в
 * админке — тихо перезаписывать/ронять прогон на unique-constraint нельзя.
 *
 * Идемпотентен: после первого прогона line уже не null, фильтр WHERE line
 * IS NULL исключает обработанные строки из следующего прогона.
 * --dry-run ничего не пишет.
 */
import { prisma } from "../prismaClient";
import { normalizeYarnKey, yarnDedupKey } from "../utils/yarnKeys";
import { composeYarnName, stripBrandPrefix } from "../utils/yarnNaming";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const candidates = await prisma.yarn.findMany({
    where: {
      line: null,
      brand: { not: null },
      mergedIntoId: null,
      isGeneric: false,
    },
    select: { id: true, name: true, brand: true, normalizedKey: true },
  });

  console.log(`Кандидатов (line пуст, бренд указан, не слит, не родовой): ${candidates.length}`);

  let filledOnly = 0;
  let renamedAndFilled = 0;
  let skippedAmbiguous = 0;
  let skippedCollisions = 0;
  const ambiguous: { id: string; name: string }[] = [];
  const collisions: { id: string; name: string; clashWith: string }[] = [];

  for (const yarn of candidates) {
    const brand = yarn.brand!; // гарантировано фильтром brand: { not: null }
    const nameTrimmed = yarn.name.trim();
    const brandTrimmed = brand.trim();

    if (nameTrimmed.toLowerCase() === brandTrimmed.toLowerCase()) {
      skippedAmbiguous++;
      ambiguous.push({ id: yarn.id, name: yarn.name });
      continue;
    }

    const stripped = stripBrandPrefix(yarn.name, brand);
    const brandWasPrefix = stripped !== nameTrimmed;
    const brandSomewhereInName = nameTrimmed.toLowerCase().includes(brandTrimmed.toLowerCase());
    // Бренд уже где-то отражён в названии (как префикс или просто
    // встречается внутри) — не дублируем его повторно спереди, только
    // дозаполняем line. Дописываем бренд спереди ТОЛЬКО когда его в
    // названии нет вовсе.
    const brandAlreadyInName = brandWasPrefix || brandSomewhereInName;

    const line = brandWasPrefix ? stripped : yarn.name;
    const name = brandAlreadyInName ? yarn.name : composeYarnName(brand, line, yarn.name);

    if (brandAlreadyInName) {
      filledOnly++;
    } else {
      renamedAndFilled++;
    }

    if (name === yarn.name) {
      // Имя не меняется — normalizedKey/dedupKey трогать незачем, просто
      // дозаполняем line этой же строке.
      if (!dryRun) {
        await prisma.yarn.update({ where: { id: yarn.id }, data: { line } });
      }
      continue;
    }

    const normalizedKey = normalizeYarnKey(name);
    if (normalizedKey !== yarn.normalizedKey) {
      const clash = await prisma.yarn.findUnique({
        where: { normalizedKey },
        select: { id: true, name: true },
      });
      if (clash && clash.id !== yarn.id) {
        skippedCollisions++;
        collisions.push({ id: yarn.id, name: yarn.name, clashWith: `${clash.id} («${clash.name}»)` });
        continue;
      }
    }

    if (!dryRun) {
      await prisma.yarn.update({
        where: { id: yarn.id },
        data: { name, line, normalizedKey, dedupKey: yarnDedupKey(name) },
      });
    }
  }

  console.log(
    (dryRun ? "[dry-run] " : "") +
      `Дозаполнено line без смены названия: ${filledOnly}, ` +
      `дозаполнено line + бренд дописан в название: ${renamedAndFilled}, ` +
      `пропущено как неоднозначные (name == brand): ${skippedAmbiguous}, ` +
      `пропущено из-за конфликта ключа (нужно ручное слияние): ${skippedCollisions}`,
  );

  if (ambiguous.length > 0) {
    console.log("Неоднозначные (name == brand, нет отдельной линейки — решить вручную):");
    for (const a of ambiguous) {
      console.log(`  ${a.id} «${a.name}»`);
    }
  }

  if (collisions.length > 0) {
    console.log("Конфликты (слить вручную через админку):");
    for (const c of collisions) {
      console.log(`  ${c.id} «${c.name}» ↔ ${c.clashWith}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
