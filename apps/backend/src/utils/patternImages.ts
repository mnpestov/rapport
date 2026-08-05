export const MAX_PATTERN_IMAGES = 5;
const UPLOADS_PREFIX = "/uploads/patterns/";

export type ImagesValidationResult =
  | { ok: true; images: string[] }
  | { ok: false; error: string };

// Shared shape/count validation for images[] — used by every write path
// (Pattern create/update, Draft create/update, sync-item edit). Does NOT
// check URL origin; see validateNewImageOrigins for that (origin rules
// differ between create and update, see pattern_images_plan.md риск №10).
export function validateImages(input: unknown, opts: { max?: number } = {}): ImagesValidationResult {
  const max = opts.max ?? MAX_PATTERN_IMAGES;

  if (!Array.isArray(input) || input.some((v) => typeof v !== "string")) {
    return { ok: false, error: "images must be an array of strings" };
  }
  if (input.length === 0) {
    return { ok: false, error: "At least one image is required" };
  }
  if (input.length > max) {
    return { ok: false, error: `No more than ${max} images allowed` };
  }
  return { ok: true, images: input };
}

// images[0] is always the cover — the only value ever written to the
// separate imageUrl column (see pattern_images_plan.md, раздел "Модель
// данных"). Caller must ensure images is non-empty (validateImages does).
export function deriveImageUrl(images: string[]): string {
  return images[0];
}

// Set difference between the row's currently-saved images and the incoming
// submission — drives both origin validation on update (only `added` must
// come from our own upload endpoint) and orphaned-file cleanup (`removed`
// files under /uploads/patterns/ get unlinked).
export function diffImages(existing: string[], incoming: string[]): { added: string[]; removed: string[] } {
  const existingSet = new Set(existing);
  const incomingSet = new Set(incoming);
  return {
    added: incoming.filter((url) => !existingSet.has(url)),
    removed: existing.filter((url) => !incomingSet.has(url)),
  };
}

// Every URL in `urls` must be one of our own /admin/upload results — never
// an arbitrary external link. Called with the full array on create (nothing
// pre-exists yet) and with only the `added` set from diffImages() on update
// (legacy scraper-origin URLs already saved on the row are grandfathered in
// unchanged — see pattern_images_plan.md риск №10).
export function validateNewImageOrigins(urls: string[]): { ok: true } | { ok: false; error: string } {
  const invalid = urls.find((url) => !url.startsWith(UPLOADS_PREFIX));
  if (invalid) {
    return { ok: false, error: `Image must be uploaded via /admin/upload: ${invalid}` };
  }
  return { ok: true };
}

export function isOwnUpload(url: string): boolean {
  return url.startsWith(UPLOADS_PREFIX);
}
