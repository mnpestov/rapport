import crypto from "crypto";
import { prisma } from "../prismaClient";

// Shared by authorApplicationController.ts (approve) and
// authorCredentialController.ts (direct grant) — kept in its own module
// rather than one importing from the other, to avoid a circular import
// between the two controllers.

const MAX_LOGIN_LENGTH = 60;

// UserCredential.login хранится всегда в нижнем регистре (нормализация на
// запись — BROWSER_ACCESS_PLAN.md §4.1). Здесь base приходит из generateSlug,
// который и так отдаёт lowercase, но toLowerCase() оставлен явно: инвариант
// должен держаться в самой функции, а не зависеть от того, что ей передали.
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export async function resolveUniqueLogin(base: string): Promise<string> {
  const normalizedBase = normalizeLogin(base);
  let candidate = normalizedBase.slice(0, MAX_LOGIN_LENGTH);
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await prisma.userCredential.findUnique({ where: { login: candidate } });
    if (!exists) return candidate;
    suffix += 1;
    const suffixStr = `-${suffix}`;
    candidate = `${normalizedBase.slice(0, MAX_LOGIN_LENGTH - suffixStr.length)}${suffixStr}`;
  }
}

// hex-only — no ambiguous-looking characters (0/O, 1/l) for a password a
// human has to type in from a Telegram message. Always ASCII, so its byte
// length always equals its character length (see authorPasswordController's
// MAX_PASSWORD_BYTES comment for why that distinction matters elsewhere).
export function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("hex").slice(0, 16);
}

// P2002's error.meta.target shape differs across Prisma/Postgres versions
// (array vs. string) — normalize once here so callers can always
// .some()/.includes() safely without re-deriving this each time.
export function normalizeP2002Target(error: any): string[] {
  const raw = error?.meta?.target;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}
