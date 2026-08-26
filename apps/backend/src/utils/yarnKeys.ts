/**
 * Нормализация названий пряжи — единственное место, где она живёт на стороне
 * бэкенда. Обязана давать тот же результат, что `key()`/`translit()` в
 * data/yarn-articles/build_reference.py: справочник собирается там, ключи
 * сравниваются здесь, и расхождение означало бы, что заливка попадёт не в те
 * строки. Совпадение проверяется скриптом checkYarnKeys.ts на всех именах
 * справочника.
 */

// Кириллические буквы, неотличимые от латинских. Магазины пишут «Alize»
// вперемешку с «Аlize», где первая буква кириллическая, и без этой замены
// получаются две карточки одной пряжи.
const HOMOGLYPHS: Record<string, string> = {
  а: "a", е: "e", о: "o", с: "c", х: "x", у: "y", р: "p", м: "m",
  в: "b", н: "h", т: "t", к: "k",
};

// Транслитерация — не косметика: авторы пишут «ализе» и «Alize», «Сеам» и
// «Seam», и без приведения к одному алфавиту это разные ключи.
// Гомоглифы снимаются РАНЬШЕ, иначе кириллическая «а» из «Аlize» уедет в
// «a» дважды по разным правилам и результат разойдётся с питоном.
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

function baseNormalize(input: string): string {
  let s = (input || "").normalize("NFKC");
  s = s.replace(/[аеосхурмвнтк]/gi, (c) => {
    const lower = c.toLowerCase();
    const mapped = HOMOGLYPHS[lower];
    return mapped ? (c === lower ? mapped : mapped.toUpperCase()) : c;
  });
  s = s.toLowerCase();
  // «Concept by Katia» и «Katia» — одна марка, слова-связки только мешают.
  s = s.replace(/\b(concept|by)\b/g, " ");
  return s.replace(/[а-яё]/g, (c) => TRANSLIT[c] ?? c);
}

/** Ключ сравнения: только буквы и цифры, без пробелов. Уникален в БД. */
export function normalizeYarnKey(input: string): string {
  return baseNormalize(input).replace(/[^a-z0-9]/g, "");
}

/**
 * Ключ дедупа — отсортированное МНОЖЕСТВО слов. Множество, а не
 * мультимножество: схлопывает и переставленный порядок («Baby Cotton XL» /
 * «Baby XL Cotton»), и задвоенный бренд («Infinity Design Design Air»).
 * Мультимножество второе не ловит.
 */
export function yarnDedupKey(input: string): string {
  const words = baseNormalize(input).match(/[a-z0-9]+/g) || [];
  return [...new Set(words)].sort().join("|");
}
