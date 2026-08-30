// Client-side mirror of the backend's bcrypt byte-limit check
// (apps/backend/src/controllers/authorPasswordController.ts — see
// implementation_plan.md §2). bcrypt truncates silently past 72 *bytes*,
// not characters — UTF-8 Cyrillic is 2 bytes/char, so a naive `.length`
// check lets a ~40-character Cyrillic password through while bcrypt hashes
// only a truncated prefix of it. This is a UX nicety only: the backend
// re-validates independently and is the actual security boundary.
export const MAX_PASSWORD_BYTES = 72;
export const MIN_PASSWORD_LENGTH = 10;

export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

export function passwordTooLong(password: string): boolean {
  return passwordByteLength(password) > MAX_PASSWORD_BYTES;
}
