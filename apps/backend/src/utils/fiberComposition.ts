/**
 * Разбор свободного текста Yarn.composition ("70% меринос, 30% полиамид")
 * на компоненты (волокно + доля). Портировано (и исправлено — см. ниже)
 * с Python-прототипа, которым разобрано 3141 значение composition с прода
 * — см. историю чата (нормализация словаря волокон, сентябрь 2026).
 *
 * Здесь только извлечение пар "число% + название" из текста. Сопоставление
 * названия с каноническим FiberType — через словарь rawToCanon в
 * fiberTypeDictionary.json (точные строки, не regex): всё, что этот словарь
 * не покрывает, остаётся нераспознанным и требует ручного дозаполнения
 * админом — это осознанно, автодогадки здесь не должно быть.
 */
// Статический import, а не fs.readFileSync по __dirname — с resolveJsonModule
// (включён в tsconfig.base.json) tsc сам копирует этот JSON в dist при сборке,
// так что файл остаётся на месте и в скомпилированном бэкенде. fs.readFileSync
// с относительным путём здесь сработал бы только пока код гоняют через tsx
// (src), как одноразовые скрипты в src/scripts, — но не после `tsc`+`node dist`.
import fiberTypeDictionary from "../data/fiberTypeDictionary.json";

export interface ParsedFiberComponent {
  /** Доля в процентах, либо null, если в тексте она не указана. */
  percentage: number | null;
  /** Сырое название волокна, как оно стоит в тексте (без %, обрезанное). */
  rawName: string;
}

const PCT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;
const SEP_RE = /[;,]/g;

function cleanSegment(seg: string): string {
  return seg
    .trim()
    .replace(SEP_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—\s]+|[-–—\s]+$/g, "");
}

/**
 * Разбирает одну строку состава на компоненты.
 *
 * Направление ("N% Имя" против "Имя N%") определяется ОДИН РАЗ для всей
 * строки, а не пословно: смотрим, есть ли текст перед самым первым числом.
 * Автор одной записи держится одного порядка на всю строку — смешение
 * направлений внутри одной composition-строки в данных не встречается.
 * (Ранняя версия этого парсера определяла направление отдельно для
 * каждого компонента и путала имена местами в многокомпонентных строках
 * вида "Хлопок 80% Шёлк 20%" — эта версия это исправляет.)
 *
 * Если в строке вообще нет "N%", делим по запятым/точкам с запятой и
 * союзам "с"/"и" — каждый кусок отдельное волокно без доли.
 */
export function parseCompositionLine(line: string): ParsedFiberComponent[] {
  const matches = [...line.matchAll(PCT_RE)];

  if (matches.length === 0) {
    const parts = line
      .split(SEP_RE)
      .map((p) => p.trim().replace(/^[-–—\s]+|[-–—\s]+$/g, ""))
      .filter(Boolean);
    const splitParts: string[] = [];
    for (const p of parts) {
      const sub = p.split(/\s+с\s+|\s+и\s+/);
      for (const s of sub) {
        const trimmed = s.trim();
        if (trimmed) splitParts.push(trimmed);
      }
    }
    return splitParts.map((rawName) => ({ percentage: null, rawName }));
  }

  const nameBeforeFirst = cleanSegment(line.slice(0, matches[0].index!));
  const nameLeads = nameBeforeFirst.length > 0;

  const results: ParsedFiberComponent[] = [];
  matches.forEach((m, i) => {
    const percentage = Math.round(parseFloat(m[1].replace(",", ".")));
    let rawName: string;
    if (nameLeads) {
      const start = i > 0 ? matches[i - 1].index! + matches[i - 1][0].length : 0;
      rawName = cleanSegment(line.slice(start, m.index!));
    } else {
      const end = i + 1 < matches.length ? matches[i + 1].index! : line.length;
      rawName = cleanSegment(line.slice(m.index! + m[0].length, end));
    }
    results.push({ percentage, rawName });
  });
  return results;
}

// ─── Словарь "сырое название -> канон" ─────────────────────────────────────
// Тот же файл, которым пользуется одноразовый backfillYarnComposition.ts —
// здесь он читается ещё и для живого разбора (см. parseYarnComposition в
// yarnsController.ts, черновик состава в админке, вариант B).
const rawToCanon = (fiberTypeDictionary as { rawToCanon: Record<string, string> }).rawToCanon;

/**
 * Каноническое название волокна (FiberType.displayName) для сырого текста,
 * как он стоял в composition — или null, если словарь его не покрывает.
 * Точное совпадение после trim+lowercase, без эвристик (см. докстринг выше).
 */
export function canonFiberNameFor(rawName: string): string | null {
  return rawToCanon[rawName.trim().toLowerCase()] ?? null;
}
