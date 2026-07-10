import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../prismaClient";
import { generateToken, generateRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { sendLoginCode } from "../services/loginCodeSender";

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
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3_600 * 1_000; // 30 days
const GRACE_PERIOD_MS = 15 * 1_000;             // concurrent-refresh grace window

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie("refresh_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth",
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^@/, "");
  return cleaned.length > 0 ? cleaned : null;
}

// Telegram usernames are case-insensitive; match accordingly.
function findUserByUsername(username: string) {
  return prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
  });
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
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    const burned = await prisma.loginCode.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (burned.count === 0) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    const accessToken = generateToken({
      userId: user.id,
      telegramId: user.telegramId.toString(),
      role: user.role,
    });

    const rawRefreshToken = generateRefreshToken({ userId: user.id });
    await prisma.refreshToken.create({
      data: {
        token: hashToken(rawRefreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    setRefreshCookie(res, rawRefreshToken);

    // Probabilistic GC — fire-and-forget, no await.
    if (Math.random() < 0.05) {
      prisma.refreshToken
        .deleteMany({ where: { expiresAt: { lt: new Date() } } })
        .catch(console.error);
    }

    res.json({
      token: accessToken,
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        role: user.role,
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
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        role: user.role,
        authorId: user.authorId,
        permissions: user.permissions.map((p) => p.permission),
      },
    });
  } catch (error) {
    console.error("[Auth] getMe failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /auth/refresh — rotates the refresh token and returns a new access token.
// Requires X-Requested-With: XMLHttpRequest (CSRF guard).
export const refresh = async (req: Request, res: Response): Promise<void> => {
  if (req.headers["x-requested-with"] !== "XMLHttpRequest") {
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
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date()) {
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
          role: record.user.role,
        });
        res.json({ token: accessToken });
        return;
      }
      // Token reuse outside grace period — revoke all user tokens.
      await prisma.refreshToken.updateMany({
        where: { userId: record.userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });
      res.clearCookie("refresh_token", { path: "/auth" });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Normal rotation: revoke old, create new.
    const now = new Date();
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revoked: true, revokedAt: now },
    });

    const newRawToken = generateRefreshToken({ userId: record.userId });
    await prisma.refreshToken.create({
      data: {
        token: hashToken(newRawToken),
        userId: record.userId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
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
      role: record.user.role,
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
      await prisma.refreshToken.updateMany({
        where: { token: hashToken(rawToken), revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });
    } catch (error) {
      console.error("[Auth] logout revoke failed:", error);
    }
  }

  res.json({ ok: true });
};
