/**
 * Единое правило сборки Yarn.name — используется ВСЕМИ путями создания и
 * редактирования артикула (админка/авторский кабинет, добавление пряжи в
 * хранилище, оба Ravelry-импорта), а не только клиентской формой
 * YarnEditModal.tsx, как было раньше.
 *
 * Раньше name и line жили каждый по себе в зависимости от пути создания:
 * YarnEditModal на фронте механически собирал name = "Бренд Линейка" и
 * всегда передавал оба поля на бэкенд, а три других пути (ручное добавление
 * пряжи в хранилище, Ravelry-фоллбек из хранилища, Ravelry-автосопоставление
 * упоминаний) каждый сам решал, как собрать name, и ни один не писал line
 * вовсе — отсюда карточки, где в названии бренд виден, а в форме
 * редактирования поле "Артикул" пустое (и наоборот, карточки без бренда в
 * названии при заполненном Yarn.brand). См. анализ в чате, октябрь 2026.
 */
export function composeYarnName(
  brand: string | null | undefined,
  line: string | null | undefined,
  fallback?: string | null,
): string {
  const parts = [brand, line]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  if (parts.length > 0) return parts.join(" ");
  return (fallback ?? "").trim();
}

/**
 * Отделяет line от свободного текста, в который пользователь мог (но не
 * обязан был) сам вписать бренд перед названием линейки — единственный
 * путь, где line в принципе не приходит отдельным полем (ручное добавление
 * пряжи в хранилище, AddYarnModal.tsx). Срабатывает, только если brand
 * стоит ЦЕЛЫМ СЛОВОМ в начале текста (после него — граница слова, не
 * продолжение буквами): иначе "Alize" отрезал бы начало от "Alizeta", а не
 * нашёл настоящий бренд. Если префикс не совпал — возвращает текст как
 * есть, и composeYarnName всё равно допишет бренд спереди при сборке name
 * (так название гарантированно содержит бренд независимо от того, ввёл ли
 * его пользователь в это поле сам).
 */
export function stripBrandPrefix(text: string, brand: string | null | undefined): string {
  const trimmed = text.trim();
  const b = (brand ?? "").trim();
  if (!b || trimmed.length <= b.length) return trimmed;
  const prefix = trimmed.slice(0, b.length);
  if (prefix.toLowerCase() !== b.toLowerCase()) return trimmed;
  const rest = trimmed.slice(b.length);
  if (!/^[\s\-–—.,]/.test(rest)) return trimmed;
  return rest.trim();
}
