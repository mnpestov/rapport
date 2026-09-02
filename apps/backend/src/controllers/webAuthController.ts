import { Request, Response } from "express";
import crypto from "crypto";
import { LoginCodePurpose } from "@prisma/client";
import { prisma } from "../prismaClient";
import { generateToken, generateRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { sendLoginCode } from "../services/loginCodeSender";
import { allowedOrigins } from "../utils/allowedOrigins";
import {
  buildPaywallState,
  createWebSession,
  hashToken,
  hasWebAccess,
  setRefreshCookie,
  REFRESH_TOKEN_TTL_MS,
} from "../services/authSession";
import { refreshSessionSubscription, clearSessionCache } from "../middlewares/enforceWebSubscription";

/**
 * Web / admin authentication via one-time Telegram codes.
 *
 * Separate from the Mini App flow (authController.telegramAuth) — that one is
 * untouched. This is the basis for the future admin panel / web login.
 *
 * Login starts from a Telegram @username: the backend resolves it to the
 * stored user (and their telegramId) itself. Codes are never stored in clear
 * text — only their SHA-256 hash is persisted.
 */

const CODE_TTL_MS = 5 * 60 * 1_000;           // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1_000;          // min interval between codes
const GRACE_PERIOD_MS = 15 * 1_000;             // concurrent-refresh grace window
// REFRESH_TOKEN_TTL_MS, hashToken и setRefreshCookie переехали в
// services/authSession.ts — там же создаётся веб-сессия, и держать вторую
// копию cookie-опций опасно: расхождение в path/sameSite ломает refresh
// молча, без падения.

// Failed-attempt counter for verify-code, keyed by telegramId (not IP — an
// IP-based limit alone is trivially bypassed via CGNAT/botnets, and this is
// what actually protects the 6-digit code from being brute-forced within its
// 5-minute TTL). After MAX_VERIFY_ATTEMPTS failures the active code is
// invalidated outright, so a fresh one has to be requested rather than just
// waiting out a cooldown. Entries expire with the same TTL as the code they
// guard — no point remembering failures past the point the code itself dies.
const MAX_VERIFY_ATTEMPTS = 5;
const verifyAttempts = new Map<string, { count: number; expiresAt: number }>();

function registerFailedAttempt(telegramId: bigint): boolean {
  const key = telegramId.toString();
  const now = Date.now();
  const entry = verifyAttempts.get(key);
  if (!entry || entry.expiresAt <= now) {
    verifyAttempts.set(key, { count: 1, expiresAt: now + CODE_TTL_MS });
    return false;
  }
  entry.count += 1;
  return entry.count >= MAX_VERIFY_ATTEMPTS;
}

function clearFailedAttempts(telegramId: bigint): void {
  verifyAttempts.delete(telegramId.toString());
}

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^@/, "");
  return cleaned.length > 0 ? cleaned : null;
}

// Telegram usernames are case-insensitive; match accordingly.
//
// Через $queryRaw, а не findFirst({ mode: "insensitive" }): Prisma
// компилирует insensitive-сравнение в ILIKE, а ILIKE не может
// воспользоваться функциональным индексом User_username_lower_idx —
// резолв шёл сиквентальным сканом по всей таблице. Здесь предикат
// записан ровно так, как объявлен индекс: lower("username") = lower($1).
//
// orderBy lastSeenAt DESC: два разных User могут исторически иметь один и
// тот же username (Telegram переиспользует освобождённые), и findFirst
// возвращал произвольного из них. Берём того, кто заходил последним, —
// почти наверняка это нынешний владелец имени.
async function findUserByUsername(username: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "User"
    WHERE lower("username") = lower(${username})
    ORDER BY "lastSeenAt" DESC NULLS LAST
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return prisma.user.findUnique({ where: { id: rows[0].id } });
}

// POST /auth/request-code — body: { username }. Resolves the user, then issues
// and delivers a one-time code. Responses never reveal whether the username exists.
export const requestCode = async (req: Request, res: Response): Promise<void> => {
  const username = normalizeUsername(req.body?.username);
  if (username === null) {
    res.status(400).json({ error: "username is required" });
    return;
  }

  try {
    const user = await findUserByUsername(username);
    if (!user) {
      if (process.env.ALLOW_DEV_AUTH === "true") {
        console.warn(`[DEV MODE] Попытка входа под несуществующим username: ${username}`);
        res.json({ ok: true, devError: `Пользователь ${username} не найден в базе данных. Сначала зайдите в Mini App через Telegram, чтобы ваш профиль создался в БД.` });
        return;
      }
      res.json({ ok: true });
      return;
    }

    const telegramId = user.telegramId;

    const lastCode = await prisma.loginCode.findFirst({
      where: { telegramId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (lastCode && Date.now() - lastCode.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      res.status(429).json({ error: "Please wait before requesting a new code" });
      return;
    }

    await prisma.loginCode.updateMany({
      where: { telegramId, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = generateCode();
    await prisma.loginCode.create({
      data: {
        telegramId,
        code: hashCode(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });

    sendLoginCode(telegramId, code).catch(console.error);

    res.json({
      ok: true,
      devCode: process.env.ALLOW_DEV_AUTH === "true" ? code : undefined,
    });
  } catch (error) {
    console.error("[Auth] requestCode failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /auth/verify-code — validates the one-time code, issues an access token
// (JSON body) and a refresh token (httpOnly cookie, path=/auth).
export const verifyCode = async (req: Request, res: Response): Promise<void> => {
  const code = req.body?.code;
  if (typeof code !== "string" || code.length === 0) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  try {
    let user;
    const username = normalizeUsername(req.body?.username);
    if (username !== null) {
      user = await findUserByUsername(username);
    } else if (req.body?.telegramId !== undefined && req.body?.telegramId !== null) {
      let telegramId: bigint;
      try {
        telegramId = BigInt(req.body.telegramId);
      } catch {
        res.status(400).json({ error: "telegramId must be numeric" });
        return;
      }
      user = await prisma.user.findUnique({ where: { telegramId } });
    } else {
      res.status(400).json({ error: "username or telegramId is required" });
      return;
    }

    if (!user) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    const record = await prisma.loginCode.findFirst({
      where: {
        telegramId: user.telegramId,
        code: hashCode(code),
        // purpose: LoginCode is shared with /reset-password (see
        // authorPasswordController.ts) — without this filter a code minted
        // for one flow could be redeemed by the other. See
        // implementation_plan.md §3.6.
        purpose: LoginCodePurpose.LOGIN,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      const exhausted = registerFailedAttempt(user.telegramId);
      if (exhausted) {
        // Too many wrong guesses against this user's active code — burn it
        // outright rather than let a brute-force loop keep spending its
        // remaining TTL. A fresh code has to be requested from scratch.
        // purpose-scoped: never touches a PASSWORD_RESET code for the same
        // telegramId.
        await prisma.loginCode.updateMany({
          where: { telegramId: user.telegramId, purpose: LoginCodePurpose.LOGIN, usedAt: null },
          data: { usedAt: new Date() },
        });
      }
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    // Гейт браузерного доступа — ДО сжигания кода: иначе пользователь без
    // WEB_ACCESS терял бы полученный код впустую и не мог бы повторить
    // попытку после выдачи доступа (BROWSER_ACCESS_PLAN.md §3.5).
    //
    // Именно этот гейт закрывает уже существовавшую дыру: /auth/verify-code
    // смонтирован давно и выдавал 30-дневную сессию вообще без проверок
    // подписки, а такие токены принимают все requireAuth-роуты.
    if (!(await hasWebAccess(user.id))) {
      res.status(403).json({ error: "web_access_not_granted" });
      return;
    }

    const burned = await prisma.loginCode.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (burned.count === 0) {
      registerFailedAttempt(user.telegramId);
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    clearFailedAttempts(user.telegramId);

    // Создание WebSession + пары токенов — общий слой (см. authSession.ts):
    // токен получает claim sessionId, по которому enforceWebSubscription
    // отличает веб-сессию от Mini App и находит запись сессии.
    const { accessToken } = await createWebSession(req, res, user);

    // Probabilistic GC — fire-and-forget, no await.
    if (Math.random() < 0.05) {
      prisma.refreshToken
        .deleteMany({ where: { expiresAt: { lt: new Date() } } })
        .catch(console.error);
    }

    const userPermissions = await prisma.userPermission.findMany({
      where: { userId: user.id },
      select: { permission: true },
    });

    res.json({
      token: accessToken,
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        role: user.role,
        authorId: user.authorId,
        permissions: userPermissions.map((p) => p.permission),
      },
    });
  } catch (error) {
    console.error("[Auth] verifyCode failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /auth/me — current user from JWT (requires requireAuth).
export const getMe = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        lastName: true,
        username: true,
        role: true,
        authorId: true,
        permissions: { select: { permission: true } },
        // Нужны для paywall-полей ниже — та же форма, что читает
        // buildPaywallState в Mini App-флоу.
        lastPaywallShownAt: true,
        premiumExpiresAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const permissions = user.permissions.map((p) => p.permission as string);

    // Подписка на канал у веб-сессии уже проверена и лежит на WebSession —
    // повторно дёргать telegram-gateway здесь незачем (BROWSER_ACCESS_PLAN.md
    // §4.8). Для Mini App-токена (нет sessionId) считаем, что раз запрос
    // дошёл сюда, вход был успешным.
    //
    // Оговорка: для whitelisted-неподписчика значение может разойтись с
    // реальностью до следующей перепроверки — whitelist-пользователей мало
    // и они известны, это принято осознанно.
    let effectiveIsSubscriber = true;
    if (req.user!.sessionId) {
      const session = await prisma.webSession.findUnique({
        where: { id: req.user!.sessionId },
        select: { subscriptionOk: true },
      });
      effectiveIsSubscriber = session?.subscriptionOk ?? false;
    }

    // Те же paywall-поля, что отдаёт /auth/telegram: без них браузерная
    // версия не знала бы, показывать ли кнопку подписки и баннер —
    // usePremiumAccess читает их из localStorage.user_data.
    const { showPaywallBanner, subscriptionWarning, paywallUiEnabled } = buildPaywallState({
      user,
      permissions,
      effectiveIsSubscriber,
      // Дев-обход кулдауна баннера здесь не нужен: это не точка входа.
      allowDevAuth: false,
    });

    res.json({
      isSubscriber: effectiveIsSubscriber,
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        role: user.role,
        authorId: user.authorId,
        permissions,
        showPaywallBanner,
        subscriptionWarning,
        paywallUiEnabled,
        premiumExpiresAt: user.premiumExpiresAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("[Auth] getMe failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// admin.rapport.su and rapport.su are same-site (same registrable domain,
// different origins) — SameSite=lax on the refresh cookie does NOT stop a
// same-site cross-origin request from carrying it, and the generic cors()
// middleware in index.ts only rejects browser-enforced preflighted requests,
// which a same-site request may not even trigger the same way. This is the
// actual CSRF boundary for the one endpoint that turns a stolen/replayed
// cookie into a fresh access token: explicitly check Origin (falling back to
// Referer's origin, since some browsers omit Origin on same-origin-looking
// requests) against the same allowlist the CORS config already trusts.
function isAllowedRefreshOrigin(req: Request): boolean {
  if (allowedOrigins.length === 0) return true; // dev fallback — matches cors()'s own open-fallback behavior
  const origin = req.headers.origin;
  if (origin) return allowedOrigins.includes(origin);
  const referer = req.headers.referer;
  if (referer) {
    try {
      return allowedOrigins.includes(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  // Neither header present — can't verify, refuse rather than assume.
  return false;
}

// POST /auth/refresh — rotates the refresh token and returns a new access token.
// Requires X-Requested-With: XMLHttpRequest (CSRF guard) AND a matching
// Origin/Referer (see isAllowedRefreshOrigin) — X-Requested-With alone isn't
// enough once API and admin panel are same-site (see comment above).
export const refresh = async (req: Request, res: Response): Promise<void> => {
  if (req.headers["x-requested-with"] !== "XMLHttpRequest") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!isAllowedRefreshOrigin(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rawToken = req.cookies?.refresh_token;
  if (!rawToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    verifyRefreshToken(rawToken);
  } catch {
    res.clearCookie("refresh_token", { path: "/auth" });
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tokenHash = hashToken(rawToken);

  try {
    const record = await prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: { user: true, session: true },
    });

    if (!record || record.expiresAt < new Date()) {
      res.clearCookie("refresh_token", { path: "/auth" });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Сессия отозвана («выйти везде», revokeAccess, снятие WEB_ACCESS, смена
    // пароля) — новый токен не выдаём. Без этой проверки отзыв не вступал бы
    // в силу до истечения текущего access-токена: ротация продолжала бы
    // молча продлевать сессию ещё на 30 дней (BROWSER_ACCESS_PLAN.md §3.11).
    if (record.session?.revoked) {
      res.clearCookie("refresh_token", { path: "/auth" });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (record.revoked) {
      if (record.revokedAt && Date.now() - record.revokedAt.getTime() <= GRACE_PERIOD_MS) {
        // Concurrent refresh from another tab — reissue access token without rotating.
        const accessToken = generateToken({
          userId: record.user.id,
          telegramId: record.user.telegramId.toString(),
          sessionId: record.sessionId ?? undefined,
        });
        res.json({ token: accessToken });
        return;
      }
      // Повторное использование токена вне grace-окна — отзываем сессию.
      //
      // Скоуп: одна СЕССИЯ, а не все токены пользователя. Раньше здесь стоял
      // updateMany по userId, и один replay (например, флапнула сеть и
      // клиент повторил запрос уже за пределами 15-секундного окна)
      // разлогинивал человека на всех устройствах сразу. Токены
      // sessionId-less (админские, выданные до внедрения WebSession) сессии
      // не имеют — для них сохраняем прежнее поведение по userId.
      const revokedAt = new Date();
      if (record.sessionId) {
        await prisma.$transaction([
          prisma.refreshToken.updateMany({
            where: { sessionId: record.sessionId, revoked: false },
            data: { revoked: true, revokedAt },
          }),
          prisma.webSession.updateMany({
            where: { id: record.sessionId, revoked: false },
            data: { revoked: true, revokedAt },
          }),
        ]);
        clearSessionCache();
      } else {
        await prisma.refreshToken.updateMany({
          where: { userId: record.userId, revoked: false },
          data: { revoked: true, revokedAt },
        });
      }
      res.clearCookie("refresh_token", { path: "/auth" });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Normal rotation: revoke old, create new. The revoke must be a single
    // atomic "UPDATE ... WHERE revoked = false" so Postgres's row lock is
    // what decides the race when two requests (e.g. React StrictMode's
    // double effect) refresh the same cookie in the same instant — only one
    // can flip revoked false->true. This is deliberately $executeRaw, not
    // prisma.refreshToken.updateMany: verified empirically that Prisma 7's
    // query engine does not compile updateMany here into one atomic
    // statement — under concurrent load it let both requests "win", each
    // proceeding to mint a token (jwt.sign's iat is second-granularity, so
    // two tokens for the same userId within the same second hash
    // identically and collide on the token unique constraint in create()).
    // Raw SQL removes that layer entirely.
    const now = new Date();
    const count = await prisma.$executeRaw`
      UPDATE "RefreshToken" SET revoked = true, "revokedAt" = ${now}
      WHERE id = ${record.id} AND revoked = false
    `;

    if (count === 0) {
      const accessToken = generateToken({
        userId: record.user.id,
        telegramId: record.user.telegramId.toString(),
        sessionId: record.sessionId ?? undefined,
      });
      res.json({ token: accessToken });
      return;
    }

    // Новый токен остаётся в ТОЙ ЖЕ сессии — метаданные (subscriptionOk,
    // lastSubscriptionCheckAt) переживают ротацию, ради чего WebSession и
    // заведена отдельной моделью.
    const newRawToken = generateRefreshToken({ userId: record.userId });
    await prisma.refreshToken.create({
      data: {
        token: hashToken(newRawToken),
        userId: record.userId,
        sessionId: record.sessionId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    if (record.sessionId) {
      await prisma.webSession.update({
        where: { id: record.sessionId },
        data: { lastActiveAt: new Date() },
      });
    }

    // Тихий refresh при загрузке страницы — тоже визит. Иначе активный
    // веб-пользователь, который не перелогинивается, месяцами числился бы
    // «не заходил»: lastSeenAt раньше обновлялся только на входе в Mini App.
    void prisma.user.update({
      where: { id: record.userId },
      data: { lastSeenAt: new Date(), lastSeenChannel: "web" },
    }).catch((err) => {
      console.error("[refresh] Failed to update lastSeenAt:", err);
    });

    // Probabilistic GC — clean up expired and old revoked records.
    if (Math.random() < 0.05) {
      prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { revoked: true, revokedAt: { lt: new Date(now.getTime() - GRACE_PERIOD_MS * 4) } },
          ],
        },
      }).catch(console.error);
    }

    setRefreshCookie(res, newRawToken);

    const accessToken = generateToken({
      userId: record.user.id,
      telegramId: record.user.telegramId.toString(),
      sessionId: record.sessionId ?? undefined,
    });

    res.json({ token: accessToken });
  } catch (error) {
    console.error("[Auth] refresh failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /auth/logout — revokes the refresh token and clears the cookie.
// Requires X-Requested-With: XMLHttpRequest (CSRF guard).
export const logout = async (req: Request, res: Response): Promise<void> => {
  if (req.headers["x-requested-with"] !== "XMLHttpRequest") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rawToken = req.cookies?.refresh_token;
  res.clearCookie("refresh_token", { path: "/auth" });

  if (rawToken) {
    try {
      // Отзываем не только сам токен, но и его сессию со всеми токенами
      // внутри: иначе выданный access-токен продолжал бы работать до 24
      // часов, а enforceWebSubscription (смотрит на WebSession.revoked) не
      // увидел бы выхода.
      const record = await prisma.refreshToken.findUnique({
        where: { token: hashToken(rawToken) },
        select: { id: true, sessionId: true },
      });
      const revokedAt = new Date();
      if (record?.sessionId) {
        await prisma.$transaction([
          prisma.refreshToken.updateMany({
            where: { sessionId: record.sessionId, revoked: false },
            data: { revoked: true, revokedAt },
          }),
          prisma.webSession.updateMany({
            where: { id: record.sessionId, revoked: false },
            data: { revoked: true, revokedAt },
          }),
        ]);
        // Иначе выход «дойдёт» до enforceWebSubscription только по
        // истечении кэша сессии.
        clearSessionCache();
      } else if (record) {
        // Токен без сессии (админский, выдан до внедрения WebSession) —
        // прежнее поведение: гасим только его.
        await prisma.refreshToken.updateMany({
          where: { id: record.id, revoked: false },
          data: { revoked: true, revokedAt },
        });
      }
    } catch (error) {
      console.error("[Auth] logout revoke failed:", error);
    }
  }

  res.json({ ok: true });
};

// POST /auth/subscription-recheck — явный «форс» проверки подписки для
// браузерной сессии (BROWSER_ACCESS_PLAN.md §4.4).
//
// Это UX-путь, а не защита: защита — enforceWebSubscription, который
// проверяет сам, независимо от того, дёрнул клиент этот эндпоинт или нет.
// Нужен для кнопки «Проверить подписку» на экране SubscriptionRequired:
// человек только что подписался и хочет продолжить, не дожидаясь
// истечения кэша.
//
// Всегда ходит в telegram-gateway, поэтому обязан иметь свой персональный
// лимитер по userId (см. routes/auth.ts) — иначе любой залогиненный мог бы
// им амплифицировать нагрузку на шлюз.
export const subscriptionRecheck = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.user?.sessionId;
  if (!sessionId) {
    // Mini App сюда не ходит: там подписка проверяется на каждом
    // /auth/telegram, отдельный эндпоинт не нужен.
    res.status(400).json({ error: "web session required" });
    return;
  }

  try {
    const session = await prisma.webSession.findUnique({
      where: { id: sessionId },
      select: {
        revoked: true,
        user: { select: { telegramId: true, username: true, firstName: true, lastName: true } },
      },
    });

    if (!session || session.revoked) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const isSubscriber = await refreshSessionSubscription({
      sessionId,
      telegramId: session.user.telegramId,
      username: session.user.username,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
    });

    res.json({ isSubscriber });
  } catch (error) {
    console.error("[Auth] subscriptionRecheck failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
