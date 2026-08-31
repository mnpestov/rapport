import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { LoginCodePurpose, Permission } from "@prisma/client";
import { prisma } from "../prismaClient";
import { sendForgotPassword } from "../services/authorNotifier";
import { normalizeLogin } from "../utils/authorCredentialHelpers";
import { buildPaywallState, createWebSession, hasWebAccess } from "../services/authSession";
import { clearSessionCache } from "../middlewares/enforceWebSubscription";

/**
 * Login/password authentication for the author cabinet — an alternative to
 * the Telegram OTP flow in webAuthController.ts, not a replacement. Both
 * lead to the same User and the same /cabinet. See implementation_plan.md.
 */

const BCRYPT_COST = 12;
const LOGIN_LOCK_MS = 15 * 60 * 1_000;
const MAX_LOGIN_ATTEMPTS = 5;
const RESET_CODE_TTL_MS = 5 * 60 * 1_000;
const FORGOT_PASSWORD_COOLDOWN_MS = 60 * 1_000;

// bcrypt truncates its input at 72 BYTES silently — no error, no signal to
// the caller. Checking password.length (JS UTF-16 code units) is not the
// same guard: Cyrillic characters are 2 bytes each in UTF-8, so a ~36+
// character Cyrillic password can already exceed 72 bytes while its
// .length still reads under 64. Without a byte-accurate check here, such a
// password would silently have its tail ignored by bcrypt.hash — two
// different passwords sharing the same 72-byte prefix would then compare as
// equal, and the user would have no way to know why. See
// implementation_plan.md §2.
const MAX_PASSWORD_BYTES = 72;

function passwordTooLong(password: string): boolean {
  return Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES;
}

// ---------------------------------------------------------------------------
// Three independent in-memory counters (see implementation_plan.md §3.1):
//   1. verifyAttempts — already exists in webAuthController.ts, per-telegramId, for OTP.
//   2. loginFailedAttempts — per-login, for password-auth (this file).
//   3. resetAttempts — per-telegramId, for password reset (this file).
// Kept separate rather than sharing one Map: each guards a different attack
// surface (OTP code guessing vs. password guessing vs. reset-code guessing),
// and merging them would let exhausting one lock out the other unrelated flow.
// ---------------------------------------------------------------------------

const loginFailedAttempts = new Map<string, { count: number; expiresAt: number }>();

// Called ONLY after a credential has been found in the DB for this login —
// otherwise the Map would grow from arbitrary login strings an attacker
// sends, with no eviction (a public, unauthenticated endpoint).
function registerLoginFailure(login: string): boolean {
  const now = Date.now();
  const entry = loginFailedAttempts.get(login);
  if (!entry || entry.expiresAt <= now) {
    loginFailedAttempts.set(login, { count: 1, expiresAt: now + LOGIN_LOCK_MS });
    return false;
  }
  entry.count += 1;
  return entry.count >= MAX_LOGIN_ATTEMPTS;
}

function clearLoginFailures(login: string): void {
  loginFailedAttempts.delete(login);
}

const resetAttempts = new Map<string, { count: number; expiresAt: number }>();

function registerResetFailure(telegramId: bigint): boolean {
  const key = telegramId.toString();
  const now = Date.now();
  const entry = resetAttempts.get(key);
  if (!entry || entry.expiresAt <= now) {
    resetAttempts.set(key, { count: 1, expiresAt: now + RESET_CODE_TTL_MS });
    return false;
  }
  entry.count += 1;
  return entry.count >= MAX_LOGIN_ATTEMPTS;
}

function clearResetAttempts(telegramId: bigint): void {
  resetAttempts.delete(telegramId.toString());
}

// forgot-password cooldown — same "only for found credentials" reasoning as
// loginFailedAttempts above.
const forgotPasswordCooldown = new Map<string, number>();

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// hashToken / setRefreshCookie / REFRESH_TOKEN_TTL_MS жили здесь своими
// копиями — теперь единственные версии в services/authSession.ts, куда
// переехало создание веб-сессии (createWebSession). Две копии cookie-опций
// разъезжались бы молча: расхождение в path или sameSite ломает refresh, но
// не падает.

async function hasAuthorCabinetAccess(userId: string): Promise<boolean> {
  const entry = await prisma.userPermission.findUnique({
    where: { userId_permission: { userId, permission: Permission.AUTHOR_CABINET } },
  });
  return !!entry;
}

// ---------------------------------------------------------------------------
// Два входа по логину/паролю — /auth/author-login (кабинет автора) и
// /auth/user-login (браузерная версия) — отличаются РОВНО одним: какой
// доступ требуется после успешной проверки пароля. Всё остальное (lockout,
// byte-truncation bcrypt, mustChangePassword, выдача сессии) у них общее,
// поэтому это параметр, а не форк файла: две копии этой логики разъехались
// бы молча (BROWSER_ACCESS_PLAN.md §3.1, решение A1).
// ---------------------------------------------------------------------------
type LoginSurface = "cabinet" | "web";

// Постоянный валидный bcrypt-хэш для выравнивания тайминга на ветках, где
// пароль не проверяется (логина нет / доступа нет). Без него время ответа
// выдавало бы существование логина: реальный bcrypt.compare ~100 мс, отказ
// без него — единицы миллисекунд (BROWSER_ACCESS_PLAN.md §4.8, S6).
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO1MtvJEuJ7VoM0Vq1JQqVoZjHqRQKNvS";

async function burnTiming(password: string): Promise<void> {
  try {
    await bcrypt.compare(password, DUMMY_HASH);
  } catch {
    // Форма хэша фиксированная и валидная; ошибка тут невозможна, но
    // «сжигание времени» не должно ронять запрос.
  }
}

/**
 * Пускать ли на эту поверхность входа.
 *
 * Веб: WEB_ACCESS (или ADMIN / AUTHOR_CABINET / мастер-рубильник) —
 * см. hasWebAccess. Кабинет: AUTHOR_CABINET, как и раньше.
 */
async function isAllowedOnSurface(surface: LoginSurface, userId: string): Promise<boolean> {
  return surface === "web" ? hasWebAccess(userId) : hasAuthorCabinetAccess(userId);
}

// Единый отказ для веб-поверхности, пока доступ не открыт публично: и
// «логина нет», и «логин есть, но доступа нет» отвечают ОДИНАКОВО и без
// Retry-After. Иначе перебор логинов показывал бы, у кого доступ уже есть.
function denyWebAccess(res: Response): void {
  res.status(403).json({ error: "web_access_not_granted" });
}

async function issueSessionResponse(
  req: Request,
  res: Response,
  user: { id: string; telegramId: bigint; firstName: string; role: any; authorId: string | null },
): Promise<void> {
  // Создание WebSession + пары токенов вынесено в общий слой: та же
  // процедура нужна verify-code и будущим веб-эндпоинтам, и расходиться им
  // нельзя (BROWSER_ACCESS_PLAN.md §3.11).
  const { accessToken } = await createWebSession(req, res, user);

  const userPermissions = await prisma.userPermission.findMany({
    where: { userId: user.id },
    select: { permission: true },
  });
  const permissions = userPermissions.map((p) => p.permission as string);

  // Paywall-поля обязаны быть и здесь: usePremiumAccess читает их из
  // localStorage.user_data, и без них браузерная версия не показывала бы
  // ни кнопку подписки, ни баннер (BROWSER_ACCESS_PLAN.md §4.3).
  // Подписка на канал только что проверена при создании сессии.
  const paywallSource = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { role: true, lastPaywallShownAt: true, premiumExpiresAt: true },
  });
  const { showPaywallBanner, subscriptionWarning, paywallUiEnabled } = buildPaywallState({
    user: paywallSource,
    permissions,
    effectiveIsSubscriber: true,
    allowDevAuth: false,
  });

  res.json({
    token: accessToken,
    user: {
      id: user.id,
      telegramId: user.telegramId.toString(),
      firstName: user.firstName,
      role: user.role,
      authorId: user.authorId,
      permissions,
      showPaywallBanner,
      subscriptionWarning,
      paywallUiEnabled,
      premiumExpiresAt: paywallSource.premiumExpiresAt?.toISOString() ?? null,
    },
  });
}

// Общая реализация входа по логину/паролю для обеих поверхностей.
// Экспортируемые authorLogin / userLogin ниже — тонкие обёртки над ней.
const loginHandler = (surface: LoginSurface) => async (req: Request, res: Response): Promise<void> => {
  const { login: rawLogin, password } = req.body ?? {};
  if (typeof rawLogin !== "string" || typeof password !== "string" || !rawLogin || !password) {
    res.status(400).json({ error: "login and password are required" });
    return;
  }
  // login хранится в БД всегда в нижнем регистре — нормализуем ввод, иначе
  // пользователь, набравший логин с заглавной, не войдёт (§4.1 плана).
  // Нормализованный вариант используется и дальше — как ключ счётчика
  // неудачных попыток, иначе "Masha"/"masha" считались бы раздельно и
  // обходили lockout.
  const login = normalizeLogin(rawLogin);

  try {
    const credential = await prisma.userCredential.findUnique({
      where: { login },
      include: { user: true },
    });

    if (!credential) {
      // loginFailedAttempts is NOT touched — no credential was found, so
      // there is nothing to key a counter on without letting an attacker
      // grow the Map with arbitrary strings.
      //
      // Веб: сжигаем то же время, что заняла бы реальная проверка пароля, и
      // отвечаем тем же 403, что и «доступа нет» — иначе перебор логинов
      // отличал бы существующие от несуществующих (S6).
      if (surface === "web") {
        await burnTiming(password);
        denyWebAccess(res);
        return;
      }
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (passwordTooLong(password)) {
      res.status(400).json({ error: "Password is too long" });
      return;
    }

    // Гейт доступа — ДО проверки пароля и ДО lockout-ветки (S6):
    //  - lockout отдаёт 429 + Retry-After только для существующего логина,
    //    то есть подтверждал бы его существование;
    //  - ранний выход из mustChangePassword ниже отвечал бы 200 раньше,
    //    чем сработал бы гейт.
    // Так «логина нет» и «логин есть, доступа нет» становятся неотличимы.
    const allowed = await isAllowedOnSurface(surface, credential.userId);
    if (!allowed) {
      if (surface === "web") {
        await burnTiming(password);
        denyWebAccess(res);
        return;
      }
      res.status(403).json({ error: "Author cabinet access not granted" });
      return;
    }

    const now = Date.now();
    if (credential.lockedUntil && credential.lockedUntil.getTime() > now) {
      const retryAfterSeconds = Math.ceil((credential.lockedUntil.getTime() - now) / 1000);
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many failed attempts, try again later" });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, credential.passwordHash);
    if (!passwordMatches) {
      const exhausted = registerLoginFailure(login);
      if (exhausted) {
        await prisma.userCredential.update({
          where: { userId: credential.userId },
          data: { lockedUntil: new Date(now + LOGIN_LOCK_MS) },
        });
      }
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    clearLoginFailures(login);
    await prisma.userCredential.update({
      where: { userId: credential.userId },
      data: { lockedUntil: null, lastLoginAt: new Date() },
    });

    if (credential.mustChangePassword) {
      res.json({ mustChangePassword: true, login });
      return;
    }

    await issueSessionResponse(req, res, credential.user);
  } catch (error) {
    console.error(`[AuthorPassword] login failed (${surface}):`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /auth/author-login — вход в кабинет автора (требует AUTHOR_CABINET).
export const authorLogin = loginHandler("cabinet");

// POST /auth/user-login — вход в браузерную версию (требует WEB_ACCESS).
export const userLogin = loginHandler("web");

// POST /auth/author-change-password — takes { login, currentPassword,
// newPassword } directly, without requireAuth: the mustChangePassword
// response from author-login carries no token to authenticate with. Uses
// the SAME rate limit and lockedUntil as author-login (§3.3) — otherwise
// this endpoint would let an attacker bypass the login lockout entirely.
const changePasswordHandler = (surface: LoginSurface) => async (req: Request, res: Response): Promise<void> => {
  const { login: rawLogin, currentPassword, newPassword } = req.body ?? {};
  if (
    typeof rawLogin !== "string" || typeof currentPassword !== "string" || typeof newPassword !== "string" ||
    !rawLogin || !currentPassword || !newPassword
  ) {
    res.status(400).json({ error: "login, currentPassword and newPassword are required" });
    return;
  }
  // См. authorLogin: тот же lockout-счётчик по тому же ключу — логин обязан
  // нормализоваться одинаково в обоих эндпоинтах, иначе смена пароля станет
  // обходом блокировки.
  const login = normalizeLogin(rawLogin);

  try {
    const credential = await prisma.userCredential.findUnique({
      where: { login },
      include: { user: true },
    });

    if (!credential) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (passwordTooLong(currentPassword)) {
      res.status(400).json({ error: "Password is too long" });
      return;
    }

    const now = Date.now();
    if (credential.lockedUntil && credential.lockedUntil.getTime() > now) {
      const retryAfterSeconds = Math.ceil((credential.lockedUntil.getTime() - now) / 1000);
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many failed attempts, try again later" });
      return;
    }

    const currentMatches = await bcrypt.compare(currentPassword, credential.passwordHash);
    if (!currentMatches) {
      const exhausted = registerLoginFailure(login);
      if (exhausted) {
        await prisma.userCredential.update({
          where: { userId: credential.userId },
          data: { lockedUntil: new Date(now + LOGIN_LOCK_MS) },
        });
      }
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    clearLoginFailures(login);
    await prisma.userCredential.update({
      where: { userId: credential.userId },
      data: { lockedUntil: null },
    });

    // Checked AFTER the current-password check, before hashing the new one:
    // if access was revoked, there is no point writing a fresh hash for a
    // now-disowned account.
    const allowed = await isAllowedOnSurface(surface, credential.userId);
    if (!allowed) {
      if (surface === "web") {
        denyWebAccess(res);
        return;
      }
      res.status(403).json({ error: "Author cabinet access not granted" });
      return;
    }

    if (passwordTooLong(newPassword) || newPassword.length < 10) {
      res.status(400).json({ error: "Password must be 10-64 characters" });
      return;
    }
    if (newPassword === login) {
      res.status(400).json({ error: "Password must not match the login" });
      return;
    }
    const sameAsCurrent = await bcrypt.compare(newPassword, credential.passwordHash);
    if (sameAsCurrent) {
      res.status(400).json({ error: "New password must differ from the current one" });
      return;
    }

    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    await prisma.$transaction([
      prisma.userCredential.update({
        where: { userId: credential.userId },
        data: { passwordHash: newPasswordHash, mustChangePassword: false, lockedUntil: null },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: credential.userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      }),
      // Вместе с токенами отзываем и сами веб-сессии: enforceWebSubscription
      // смотрит на WebSession.revoked, и живая сессия пережила бы смену
      // пароля, продолжая пускать по ещё не истёкшему access-токену.
      prisma.webSession.updateMany({
        where: { userId: credential.userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      }),
    ]);
    clearSessionCache();

    await issueSessionResponse(req, res, credential.user);
  } catch (error) {
    console.error(`[AuthorPassword] changePassword failed (${surface}):`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /auth/author-change-password — смена временного пароля для кабинета.
export const authorChangePassword = changePasswordHandler("cabinet");

// POST /auth/user-change-password — то же для браузерной версии.
export const userChangePassword = changePasswordHandler("web");

// POST /auth/forgot-password
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { login: rawLogin } = req.body ?? {};
  if (typeof rawLogin !== "string" || !rawLogin) {
    res.status(400).json({ error: "login is required" });
    return;
  }
  // Нормализация — и для поиска, и как ключ forgotPasswordCooldown (§4.1).
  const login = normalizeLogin(rawLogin);

  try {
    const credential = await prisma.userCredential.findUnique({ where: { login } });
    if (!credential) {
      // Generic response — do not reveal whether the login exists.
      // Cooldown map is NOT touched (same "only for found credentials"
      // reasoning as loginFailedAttempts).
      res.json({ ok: true });
      return;
    }

    const now = Date.now();
    const lastSent = forgotPasswordCooldown.get(login);
    if (lastSent && now - lastSent < FORGOT_PASSWORD_COOLDOWN_MS) {
      res.json({ ok: true }); // silent — same generic response as "not found"
      return;
    }
    forgotPasswordCooldown.set(login, now);

    const telegramId = (await prisma.user.findUnique({
      where: { id: credential.userId },
      select: { telegramId: true },
    }))?.telegramId;
    if (!telegramId) {
      res.json({ ok: true });
      return;
    }

    const code = generateCode();
    await prisma.loginCode.create({
      data: {
        telegramId,
        code: hashCode(code),
        purpose: LoginCodePurpose.PASSWORD_RESET,
        expiresAt: new Date(now + RESET_CODE_TTL_MS),
      },
    });

    sendForgotPassword(telegramId, code).catch(console.error);

    res.json({ ok: true });
  } catch (error) {
    console.error("[AuthorPassword] forgotPassword failed:", error);
    // Even on internal failure, don't leak existence — but do surface a
    // generic 500 so the client doesn't think a code was actually sent.
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /auth/reset-password
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { login: rawLogin, code, newPassword } = req.body ?? {};
  if (
    typeof rawLogin !== "string" || typeof code !== "string" || typeof newPassword !== "string" ||
    !rawLogin || !code || !newPassword
  ) {
    res.status(400).json({ error: "login, code and newPassword are required" });
    return;
  }
  // Нормализация — и для поиска, и для сравнения newPassword === login ниже.
  const login = normalizeLogin(rawLogin);

  try {
    const credential = await prisma.userCredential.findUnique({
      where: { login },
      include: { user: true },
    });

    // Conscious tradeoff — same class as author-login (§3.2): a
    // non-existent login always 401s immediately; an existing one proceeds
    // to check the code. Logins aren't public and the author base is small.
    if (!credential) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    const telegramId = credential.user.telegramId;

    const record = await prisma.loginCode.findFirst({
      where: {
        telegramId,
        code: hashCode(code),
        purpose: LoginCodePurpose.PASSWORD_RESET,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      const exhausted = registerResetFailure(telegramId);
      if (exhausted) {
        // purpose-scoped burn — never touches a LOGIN code for the same
        // telegramId (see LoginCodePurpose comment in schema.prisma).
        await prisma.loginCode.updateMany({
          where: { telegramId, purpose: LoginCodePurpose.PASSWORD_RESET, usedAt: null },
          data: { usedAt: new Date() },
        });
      }
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    const burned = await prisma.loginCode.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (burned.count === 0) {
      registerResetFailure(telegramId);
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    clearResetAttempts(telegramId);

    if (passwordTooLong(newPassword) || newPassword.length < 10) {
      res.status(400).json({ error: "Password must be 10-64 characters" });
      return;
    }
    if (newPassword === login) {
      res.status(400).json({ error: "Password must not match the login" });
      return;
    }

    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    await prisma.$transaction([
      prisma.userCredential.update({
        where: { userId: credential.userId },
        data: { passwordHash: newPasswordHash, mustChangePassword: false, lockedUntil: null },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: credential.userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      }),
      // Вместе с токенами отзываем и сами веб-сессии: enforceWebSubscription
      // смотрит на WebSession.revoked, и живая сессия пережила бы смену
      // пароля, продолжая пускать по ещё не истёкшему access-токену.
      prisma.webSession.updateMany({
        where: { userId: credential.userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      }),
    ]);
    clearSessionCache();

    res.json({ ok: true });
  } catch (error) {
    console.error("[AuthorPassword] resetPassword failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
