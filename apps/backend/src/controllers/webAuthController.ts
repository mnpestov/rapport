import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../prismaClient";
import { generateToken } from "../utils/jwt";
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

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // min interval between codes per user

function generateCode(): string {
  // 6-digit numeric, cryptographically random.
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
function findUserByUsername(username: string) {
  return prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
  });
}

// POST /auth/request-code — body: { username }. Resolves the user, then issues
// and delivers (stubbed) a one-time code. Responses never reveal whether the
// username exists.
export const requestCode = async (req: Request, res: Response): Promise<void> => {
  const username = normalizeUsername(req.body?.username);
  if (username === null) {
    res.status(400).json({ error: "username is required" });
    return;
  }

  try {
    const user = await findUserByUsername(username);
    // Unknown username: respond OK without sending, to avoid user enumeration.
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

    // Rate limit: at most one new code per RESEND_COOLDOWN_MS per user.
    const lastCode = await prisma.loginCode.findFirst({
      where: { telegramId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (
      lastCode &&
      Date.now() - lastCode.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      res.status(429).json({ error: "Please wait before requesting a new code" });
      return;
    }

    // One active code at a time: invalidate previous unused codes.
    await prisma.loginCode.updateMany({
      where: { telegramId, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = generateCode();
    await prisma.loginCode.create({
      data: {
        telegramId,
        code: hashCode(code), // store hash, never the plaintext
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });

    // Deliver the plaintext code without blocking the response.
    sendLoginCode(telegramId, code).catch(console.error);

    res.json({ 
      ok: true,
      devCode: process.env.ALLOW_DEV_AUTH === "true" ? code : undefined
    });
  } catch (error) {
    console.error("[Auth] requestCode failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /auth/verify-code — body: { username | telegramId, code }. Validates the
// hashed code and issues a JWT (userId + role).
export const verifyCode = async (req: Request, res: Response): Promise<void> => {
  const code = req.body?.code;
  if (typeof code !== "string" || code.length === 0) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  try {
    // Resolve the target user from username (preferred) or telegramId (compat).
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
      // Do not distinguish unknown user from bad code.
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

    // Mark used (one-time). Atomic guard so a code can only burn once.
    const burned = await prisma.loginCode.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (burned.count === 0) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    const token = generateToken({
      userId: user.id,
      telegramId: user.telegramId.toString(),
      role: user.role,
    });

    res.json({
      token,
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
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      user: { ...user, telegramId: user.telegramId.toString() },
    });
  } catch (error) {
    console.error("[Auth] getMe failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
