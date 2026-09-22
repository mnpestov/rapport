/**
 * Скоринг совместимости составов пряжи — используется внутри критерия
 * "толщина" при подборе описаний (stashController.ts getMatches), не как
 * отдельный независимый критерий: описание проходит только если толщина
 * СОВПАЛА И состав дал допустимый уровень (не X). Согласовано на реальном
 * примере в сессии (см. чат, сентябрь 2026): Persiano (45% беби-альпака +
 * 25% меринос + 30% нейлон) против описания на Lang Yarns Lambswool (100%
 * меринос) — связка была реально провязана в 3 сложения и должна
 * находиться СИММЕТРИЧНО (мотка → описание и описание → мотка дают тот же
 * уровень), это откалибровало и алгоритм, и пороги ниже.
 *
 * Алгоритм — пропорциональное распределение (не жадный 1-к-1 матчинг):
 * ранняя жадная версия ломала симметрию направления (компонент кандидата
 * доставался целиком первому по величине компоненту оригинала, остальные
 * оставались без пары) — заменено на транспортную задачу:
 *
 *  1. Для каждого компонента КАНДИДАТА его доля делится между ВСЕМИ
 *     совместимыми (level != X по FiberSubstitute) компонентами ОРИГИНАЛА
 *     пропорционально их собственным долям. Пример: кандидат 100% Шерсть,
 *     оригинал 45% Альпака + 25% Шерсть (оба совместимы с Шерстью) — 100%
 *     делится в пропорции 45:25, Альпака получает 64.3%, Шерсть — 35.7%.
 *     Это математически симметрично: поменяв местами оригинал/кандидат,
 *     получаем согласованный (не идентичный по числам, но взаимно
 *     непротиворечивый) результат — оба направления либо оба проходят,
 *     либо оба не проходят, при одинаковых порогах.
 *  2. Отклонение "полученной" доли компонента оригинала от его
 *     исходной доли — допуск ≤30 п.п. (АБСОЛЮТНЫЕ процентные пункты).
 *  3. Компонент оригинала, не получивший НИ ОДНОЙ доли (ни один компонент
 *     кандидата с ним не совместим):
 *     - если это MATERIAL-компонент — допустимо, если его доля ≤15%
 *       ("удаление" материала, которого не нашлось в кандидате);
 *     - если это FUNCTIONAL-компонент (нейлон, эластан и т.п.) — ВСЕГДА
 *       допустимо, независимо от доли. Причина: у мотка пользователя есть
 *       нейлон "для прочности", но у НАЙДЕННОГО ОПИСАНИЯ просто нет
 *       требования к этому аспекту — это не "потеря важного свойства",
 *       а нейтральное отсутствие требования. Согласовано явно в сессии —
 *       без этого правила реальный проверенный кейс (Persiano → Lambswool)
 *       не проходил.
 *  4. Компонент КАНДИДАТА, чья доля целиком не была использована ни одним
 *     совместимым компонентом оригинала (т.е. в оригинале нет ничего, с
 *     чем он мог бы сочетаться) — допустимо, если его доля ≤30%
 *     ("добавление" лишнего волокна, которого не было в оригинале).
 *
 * Итоговый уровень пары составов = худший (наименее совместимый) из
 * уровней всех сопоставленных компонентов оригинала; при срабатывании
 * любого порога — пара целиком отклоняется (X).
 */
import { prisma } from "../prismaClient";

export type SubstituteLevel = "A" | "B" | "C" | "X";
type SubstituteRole = "MATERIAL" | "FUNCTIONAL" | "VISUAL" | "DECORATIVE";

const LEVEL_RANK: Record<SubstituteLevel, number> = { A: 0, B: 1, C: 2, X: 3 };

// Все конфигурируемые пороги в одном месте (draft: "пороги должны быть
// конфигурируемыми, а не зашитыми в логику приложения").
export const COMPOSITION_MATCH_THRESHOLDS = {
  /** Максимальное отклонение "полученной" доли компонента оригинала от исходной, в процентных пунктах. */
  maxDeviationPp: 30,
  /** MATERIAL-компонент оригинала без пары в кандидате допустим, если его доля не выше этого. */
  maxUnmatchedMaterialPct: 15,
  /** Лишний компонент кандидата без пары в оригинале допустим, если его доля не выше этого. */
  maxUnmatchedCandidatePct: 30,
};

interface Component {
  baseFiber: string;
  percentage: number | null;
}

interface SubstituteEdge {
  level: SubstituteLevel;
  role: SubstituteRole;
}

/**
 * Строит таблицу поиска (source, target) -> {level, role} из всех строк
 * FiberSubstitute, разворачивая symmetric-пары в обе стороны. Вызывающий
 * код грузит это один раз на запрос (не на пару кандидатов) — таблица
 * маленькая (десятки строк), кешировать между запросами пока не нужно.
 */
async function loadSubstituteIndex(): Promise<Map<string, SubstituteEdge>> {
  const rows = await prisma.fiberSubstitute.findMany({
    select: { source: true, target: true, level: true, role: true, symmetric: true },
  });
  const index = new Map<string, SubstituteEdge>();
  for (const r of rows) {
    index.set(`${r.source}\u0000${r.target}`, { level: r.level, role: r.role });
    if (r.symmetric) {
      index.set(`${r.target}\u0000${r.source}`, { level: r.level, role: r.role });
    }
  }
  return index;
}

/** Прямое совпадение baseFiber — всегда уровень A. Роль для критичного правила берётся из самого компонента оригинала, не из ребра. */
function lookupLevel(index: Map<string, SubstituteEdge>, source: string, target: string): SubstituteLevel | null {
  if (source === target) return "A";
  return index.get(`${source}\u0000${target}`)?.level ?? null;
}

/** Роль волокна как "обычно функционального" — если оно хоть где-то в таблице заменителей участвует с role=FUNCTIONAL. */
function isFunctionalFiber(index: Map<string, SubstituteEdge>, baseFiber: string): boolean {
  for (const [key, edge] of index) {
    if (key.startsWith(`${baseFiber}\u0000`) && edge.role === "FUNCTIONAL") return true;
  }
  return false;
}

export interface CompositionMatchResult {
  level: SubstituteLevel; // X = не совместимо, пара не должна попадать в выдачу
  matchedComponents: {
    originalBaseFiber: string;
    originalPct: number;
    receivedPct: number;
    deviationPp: number;
    level: SubstituteLevel;
  }[];
  unmatchedOriginal: Record<string, number>;
  unmatchedCandidate: Record<string, number>;
}

/**
 * Сравнивает состав оригинала (мотка пользователя ИЛИ, в обратном
 * направлении, требуемый состав описания — функция направленно-нейтральна
 * по построению) с составом кандидата. Оба — уже структурированные
 * {baseFiber, percentage} компоненты. Пустой массив у любой стороны —
 * ответственность вызывающего кода: эта функция всегда попытается
 * посчитать, при отсутствии совместимых компонентов вернёт X.
 */
export function scoreComposition(
  original: Component[],
  candidate: Component[],
  substituteIndex: Map<string, SubstituteEdge>,
  thresholds = COMPOSITION_MATCH_THRESHOLDS,
): CompositionMatchResult {
  const originalWithPct = original.filter((c) => c.percentage != null) as { baseFiber: string; percentage: number }[];
  const candidateWithPct = candidate.filter((c) => c.percentage != null) as { baseFiber: string; percentage: number }[];

  // Для каждого компонента оригинала — сколько "получил" (транспортная
  // задача, шаг 1 в докстринге) и какой лучший уровень среди источников.
  const received = new Map<string, number>();
  const bestLevelByOriginal = new Map<string, SubstituteLevel>();
  // Сколько доли каждого компонента кандидата было "разобрано" хоть кем-то
  // из оригинала — остаток (обычно 0, т.к. вся доля распределяется) не
  // считается: важен сам факт "нашёлся ли хоть один совместимый оригинал".
  const candidateHasMatch = new Set<string>();

  for (const cand of candidateWithPct) {
    const compatible = originalWithPct
      .map((o) => ({ o, level: lookupLevel(substituteIndex, o.baseFiber, cand.baseFiber) }))
      .filter((x): x is { o: typeof originalWithPct[number]; level: SubstituteLevel } => x.level != null && x.level !== "X");
    if (compatible.length === 0) continue;
    candidateHasMatch.add(cand.baseFiber);
    const totalWeight = compatible.reduce((sum, x) => sum + x.o.percentage, 0);
    if (totalWeight === 0) continue;
    for (const { o, level } of compatible) {
      const share = (o.percentage / totalWeight) * cand.percentage;
      received.set(o.baseFiber, (received.get(o.baseFiber) ?? 0) + share);
      const prev = bestLevelByOriginal.get(o.baseFiber);
      if (!prev || LEVEL_RANK[level] < LEVEL_RANK[prev]) bestLevelByOriginal.set(o.baseFiber, level);
    }
  }

  const matchedComponents: CompositionMatchResult["matchedComponents"] = [];
  const unmatchedOriginal: Record<string, number> = {};

  for (const o of originalWithPct) {
    const got = received.get(o.baseFiber);
    if (got == null || got === 0) {
      unmatchedOriginal[o.baseFiber] = o.percentage;
      continue;
    }
    matchedComponents.push({
      originalBaseFiber: o.baseFiber,
      originalPct: o.percentage,
      receivedPct: got,
      deviationPp: Math.abs(o.percentage - got),
      level: bestLevelByOriginal.get(o.baseFiber)!,
    });
  }

  const unmatchedCandidate: Record<string, number> = {};
  for (const c of candidateWithPct) {
    if (!candidateHasMatch.has(c.baseFiber)) unmatchedCandidate[c.baseFiber] = c.percentage;
  }

  if (matchedComponents.length === 0) {
    return { level: "X", matchedComponents, unmatchedOriginal, unmatchedCandidate };
  }

  // Несопоставленные компоненты ОРИГИНАЛА: MATERIAL блокирует при доле
  // >15%, FUNCTIONAL не блокирует никогда (описание просто не предъявляет
  // требования к этому аспекту — см. докстринг, шаг 3).
  for (const [baseFiber, pct] of Object.entries(unmatchedOriginal)) {
    if (isFunctionalFiber(substituteIndex, baseFiber)) continue;
    if (pct > thresholds.maxUnmatchedMaterialPct) {
      return { level: "X", matchedComponents, unmatchedOriginal, unmatchedCandidate };
    }
  }

  // Несопоставленные компоненты КАНДИДАТА ("добавление" лишнего волокна).
  for (const pct of Object.values(unmatchedCandidate)) {
    if (pct > thresholds.maxUnmatchedCandidatePct) {
      return { level: "X", matchedComponents, unmatchedOriginal, unmatchedCandidate };
    }
  }

  let worstRank = 0;
  for (const m of matchedComponents) {
    if (m.deviationPp > thresholds.maxDeviationPp) {
      return { level: "X", matchedComponents, unmatchedOriginal, unmatchedCandidate };
    }
    worstRank = Math.max(worstRank, LEVEL_RANK[m.level]);
  }

  const finalLevel = (["A", "B", "C"] as const)[worstRank] ?? "X";
  return { level: finalLevel, matchedComponents, unmatchedOriginal, unmatchedCandidate };
}

export { loadSubstituteIndex };
