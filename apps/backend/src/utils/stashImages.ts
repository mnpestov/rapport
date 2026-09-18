/**
 * Валидация фото хранилища пряжи (YARN_STASH_PLAN.md T8) — зеркалит
 * patternImages.ts (UPLOADS_PREFIX/validateNewImageOrigins/isOwnUpload), но
 * отдельным модулем, а не параметризацией существующего: patternImages.ts
 * используется на четырёх потоках Pattern/Draft уже сегодня
 * (authorController/adminModerationController/syncController/
 * adminPatternsController) — трогать общий модуль ради хранилища значило бы
 * рисковать регрессией на проверенном коде без необходимости.
 */

export const MAX_STASH_IMAGES_PER_SKEIN = 5;
export const MAX_STASH_IMAGES_PER_SWATCH = 5;

const UPLOADS_PREFIX = "/uploads/yarn-stash/";

export function isOwnStashUpload(url: string): boolean {
  return url.startsWith(UPLOADS_PREFIX);
}

// Каждая новая ссылка в images[] обязана быть результатом POST
// /stash/upload — не произвольным внешним URL. Симметрично
// validateNewImageOrigins в patternImages.ts.
export function validateNewStashImageOrigins(urls: string[]): { ok: true } | { ok: false; error: string } {
  const invalid = urls.find((url) => !isOwnStashUpload(url));
  if (invalid) {
    return { ok: false, error: `Image must be uploaded via /stash/upload: ${invalid}` };
  }
  return { ok: true };
}
