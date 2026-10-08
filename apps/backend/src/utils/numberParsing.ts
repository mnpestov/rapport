/**
 * Разбор числа из пользовательского ввода, принимая и точку, и запятую как
 * разделитель дробной части — привычный для русской раскладки ввод "32,5"
 * без этой замены уходит как NaN, а JSON.stringify на фронте молча
 * превращает NaN в null ещё до отправки запроса (см. анализ в чате,
 * октябрь 2026). Возвращает null вместо NaN, если строка всё равно не
 * является числом — иначе NaN уронил бы запись в Decimal-поле Prisma.
 */
export function parseDecimalInput(v: unknown): number | null {
  if (v == null || v === "") return null;
  const normalized = String(v).trim().replace(",", ".");
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
