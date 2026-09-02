import crypto from "crypto";
import { ApplicationStatus } from "@prisma/client";
import { prisma } from "../prismaClient";

// Shared by authorApplicationController.ts (approve) and
// authorCredentialController.ts (direct grant) — kept in its own module
// rather than one importing from the other, to avoid a circular import
// between the two controllers.

const MAX_LOGIN_LENGTH = 60;

// ---------------------------------------------------------------------------
// Правила логина, который пользователь придумывает сам — при заведении
// доступа на сайт (userCredentialController) и при подаче заявки на кабинет
// автора. Единственное место, где эти правила заданы; остальные их
// импортируют.
// ---------------------------------------------------------------------------

export const LOGIN_MIN = 3;
export const LOGIN_MAX = 30;
export const LOGIN_RE = /^[a-z0-9._-]+$/;

/**
 * Проверяет формат придуманного пользователем логина и приводит его к
 * нормальному виду (нижний регистр, без пробелов по краям). Сообщения
 * об ошибке — на русском, показываются пользователю в боте.
 */
export function validateLogin(
  raw: unknown
): { ok: true; login: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "Логин обязателен" };
  }
  const login = normalizeLogin(raw);
  if (login.length < LOGIN_MIN || login.length > LOGIN_MAX) {
    return { ok: false, error: `Логин должен быть от ${LOGIN_MIN} до ${LOGIN_MAX} символов` };
  }
  if (!LOGIN_RE.test(login)) {
    return {
      ok: false,
      error: "Логин может содержать только латинские буквы, цифры, точку, дефис и подчёркивание",
    };
  }
  return { ok: true, login };
}

// Заявки в этих статусах держат за собой логin (см. комментарий к
// AuthorApplication.desiredLogin). REJECTED сюда не входит — при отклонении
// логин очищается.
const LOGIN_HOLDING_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.DRAFT,
  ApplicationStatus.PENDING,
  ApplicationStatus.NEEDS_INFO,
  ApplicationStatus.APPROVED,
];

/**
 * Свободен ли логин. Занятым считается логин, который:
 *  - уже есть среди выданных учётных записей, либо
 *  - держится живой заявкой на кабинет автора (DRAFT/PENDING/NEEDS_INFO/APPROVED).
 *
 * exceptUserId — чей собственный «захват» не считать конфликтом: заявка-черновик
 * самого пользователя, когда он переприсылает тот же логин.
 */
export async function isLoginAvailable(
  login: string,
  exceptUserId?: string
): Promise<boolean> {
  const normalized = normalizeLogin(login);

  const credential = await prisma.userCredential.findUnique({
    where: { login: normalized },
    select: { userId: true },
  });
  if (credential && credential.userId !== exceptUserId) return false;

  const application = await prisma.authorApplication.findFirst({
    where: {
      desiredLogin: normalized,
      status: { in: LOGIN_HOLDING_STATUSES },
      ...(exceptUserId ? { NOT: { userId: exceptUserId } } : {}),
    },
    select: { id: true },
  });
  if (application) return false;

  return true;
}

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
