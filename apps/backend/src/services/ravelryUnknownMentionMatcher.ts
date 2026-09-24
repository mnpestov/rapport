/**
 * Дозаполнение нераспознанных упоминаний пряжи (PatternYarnMention,
 * kind: UNKNOWN_ARTICLE) через поиск в Ravelry — отдельный batch-шаг,
 * запускаемый вручную/по cron ПОСЛЕ прогона author_sync.py, а не встроенный
 * в сам скрапер: скрапер — Python, Ravelry-клиент — TS (ravelryClient.ts),
 * дублировать HTTP-клиент на два языка незачем, а throttling списка из
 * потенциально многих mentions уместнее держать отдельно от скрапинга
 * новинок (разная частота, разная точка отказа).
 *
 * Критерий совпадения — только ТОЧНОЕ совпадение нормализованного ключа
 * (normalizeYarnKey(rawText) === normalizeYarnKey(результат Ravelry)), тот
 * же порог, что EXACT-правило в yarn_lib/match.py. Слабее — не годится:
 * восемь правил в yarn_lib калиброваны по точности именно потому, что
 * "похоже" даёт много ложных карточек. Если Ravelry вернул совпадение
 * по ключу — создаём Yarn(status: PENDING, createdVia: SCRAPER_RAVELRY) и
 * привязываем как suggestedYarnId+matchRule на mention (mention.status
 * остаётся PENDING — модератор видит предложение при разборе новинки,
 * ровно как для слабых правил в yarn_lib, только тут уверенность выше).
 */
import { Prisma, YarnMatchRule, YarnMentionStatus, YarnStatus } from "@prisma/client";
import { prisma } from "../prismaClient";
import { normalizeYarnKey, yarnDedupKey } from "../utils/yarnKeys";
import { searchRavelryYarns, getRavelryYarnDetail, toMPer100g, formatComposition } from "./ravelryClient";

// Ravelry не публикует официальную квоту для Personal read-only ключей —
// задержка между запросами взята с запасом, чтобы batch по сотне
// упоминаний не словил троттлинг/бан ключа.
const REQUEST_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MatchResult {
  mentionId: string;
  rawText: string;
  outcome: "matched_existing" | "matched_created" | "no_match" | "error";
  yarnId?: string;
  error?: string;
}

// Находит или создаёт Yarn по точному ключу среди результатов поиска —
// не берёт "первый результат" вслепую (как enrichYarnFromRavelrySearch для
// дозаполнения), а требует, чтобы ХОТЯ БЫ ОДИН вариант из выдачи Ravelry
// после нормализации совпал буква-в-букву с исходным упоминанием.
async function findExactRavelryMatch(rawText: string): Promise<number | null> {
  const targetKey = normalizeYarnKey(rawText);
  if (!targetKey) return null;

  const { yarns } = await searchRavelryYarns(rawText);
  for (const y of yarns) {
    const candidateName = y.yarn_company_name ? `${y.yarn_company_name} ${y.name}` : y.name;
    if (normalizeYarnKey(candidateName) === targetKey) return y.id;
  }
  return null;
}

async function createOrReuseYarn(ravelryId: number): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.yarn.findUnique({ where: { ravelryId }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  const detail = await getRavelryYarnDetail(ravelryId);
  const name = detail.yarn_company ? `${detail.yarn_company.name} ${detail.name}` : detail.name;
  const normalizedKey = normalizeYarnKey(name);

  try {
    const created = await prisma.yarn.create({
      data: {
        name,
        brand: detail.yarn_company?.name ?? null,
        normalizedKey,
        dedupKey: yarnDedupKey(name),
        mPer100g: toMPer100g(detail.yardage, detail.grams),
        composition: formatComposition(detail.yarn_fibers),
        needleMinMm: detail.min_needle_size?.metric ?? null,
        needleMaxMm: detail.max_needle_size?.metric ?? null,
        sourceName: "Ravelry",
        sourceUrl: `https://www.ravelry.com/yarns/library/${detail.permalink}`,
        ravelryId: detail.id,
        status: YarnStatus.PENDING,
        createdVia: "SCRAPER_RAVELRY",
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Гонка или normalizedKey уже занят записью, созданной другим путём
      // (ручной ввод/другой ravelryId с тем же итоговым именем) — тот же
      // разбор случаев, что в importRavelryYarn.
      const byKey = await prisma.yarn.findFirst({
        where: { OR: [{ normalizedKey }, { ravelryId }] },
        select: { id: true },
      });
      if (byKey) return { id: byKey.id, created: false };
    }
    throw error;
  }
}

/**
 * Обходит все ещё не обработанные нераспознанные упоминания (PENDING,
 * UNKNOWN_ARTICLE, suggestedYarnId ещё не проставлен — повторный прогон не
 * бьёт по тем же mentions заново) и пытается найти точное совпадение в
 * Ravelry. limit — на случай очень большой очереди, чтобы не упереться в
 * лимиты Ravelry за один прогон.
 */
export async function matchUnknownMentionsWithRavelry(limit = 200): Promise<MatchResult[]> {
  const mentions = await prisma.patternYarnMention.findMany({
    where: {
      status: YarnMentionStatus.PENDING,
      kind: "UNKNOWN_ARTICLE",
      suggestedYarnId: null,
    },
    select: { id: true, rawText: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const results: MatchResult[] = [];

  for (const mention of mentions) {
    try {
      const ravelryId = await findExactRavelryMatch(mention.rawText);
      if (ravelryId == null) {
        results.push({ mentionId: mention.id, rawText: mention.rawText, outcome: "no_match" });
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const { id: yarnId, created } = await createOrReuseYarn(ravelryId);
      await prisma.patternYarnMention.update({
        where: { id: mention.id },
        data: { suggestedYarnId: yarnId, matchRule: YarnMatchRule.EXACT },
      });

      results.push({
        mentionId: mention.id,
        rawText: mention.rawText,
        outcome: created ? "matched_created" : "matched_existing",
        yarnId,
      });
    } catch (error) {
      results.push({
        mentionId: mention.id,
        rawText: mention.rawText,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return results;
}
