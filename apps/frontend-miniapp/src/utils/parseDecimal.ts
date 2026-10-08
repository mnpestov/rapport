// Разбор числа из поля ввода, принимая и точку, и запятую как разделитель
// дробной части — привычный для русской раскладки ввод "32,5" без этой
// замены даёт NaN, а JSON.stringify молча превращает NaN в null ещё до
// отправки запроса (значение пропадало бы незаметно для пользователя).
// См. анализ в чате, октябрь 2026.
export function parseDecimalInput(value: string): number | undefined {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}
