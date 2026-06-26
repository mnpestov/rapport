import { Request, Response } from "express";
import { prisma } from "../prismaClient";

// Serialize a WhitelistedUser record — BigInt telegramId → string for JSON transport.
function serialize(entry: {
  id: string;
  telegramId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  comment: string | null;
  forceAllow: boolean;
  debugLogging: boolean;
  needsInvestigation: boolean;
  lastWhitelistAuthorizationAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}) {
  return {
    ...entry,
    telegramId: entry.telegramId.toString(),
    lastWhitelistAuthorizationAt: entry.lastWhitelistAuthorizationAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export const getWhitelist = async (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  // telegramId is BigInt — only exact match is possible without raw SQL.
  // Include it in OR when the search string looks like a plain integer.
  const telegramIdCondition = /^\d+$/.test(search)
    ? [{ telegramId: { equals: BigInt(search) } }]
    : [];

  const where = search
    ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' as const } },
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { comment: { contains: search, mode: 'insensitive' as const } },
          ...telegramIdCondition,
        ],
      }
    : {};

  try {
    const entries = await prisma.whitelistedUser.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return res.json(entries.map(serialize));
  } catch (error) {
    console.error("[Whitelist] Failed to fetch:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const createWhitelistEntry = async (req: Request, res: Response) => {
  const { telegramId, username, firstName, lastName, comment, forceAllow, debugLogging } = req.body;

  if (!telegramId) {
    return res.status(400).json({ error: "telegramId is required" });
  }

  let telegramIdBig: bigint;
  try {
    telegramIdBig = BigInt(telegramId);
  } catch {
    return res.status(400).json({ error: "telegramId must be a valid integer" });
  }

  const createdBy = req.user?.userId ?? null;

  try {
    const entry = await prisma.whitelistedUser.create({
      data: {
        telegramId: telegramIdBig,
        username: username || null,
        firstName: firstName || null,
        lastName: lastName || null,
        comment: comment || null,
        ...(forceAllow !== undefined ? { forceAllow: Boolean(forceAllow) } : {}),
        ...(debugLogging !== undefined ? { debugLogging: Boolean(debugLogging) } : {}),
        createdBy,
      },
    });
    return res.status(201).json(serialize(entry));
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: "Пользователь с таким telegramId уже в белом списке" });
    }
    console.error("[Whitelist] Failed to create:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateWhitelistEntry = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { username, firstName, lastName, comment, forceAllow, debugLogging, needsInvestigation } = req.body;

  try {
    const entry = await prisma.whitelistedUser.update({
      where: { id },
      data: {
        username: username ?? undefined,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        comment: comment ?? undefined,
        ...(forceAllow !== undefined ? { forceAllow: Boolean(forceAllow) } : {}),
        ...(debugLogging !== undefined ? { debugLogging: Boolean(debugLogging) } : {}),
        ...(needsInvestigation !== undefined ? { needsInvestigation: Boolean(needsInvestigation) } : {}),
      },
    });
    return res.json(serialize(entry));
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: "Запись не найдена" });
    }
    console.error("[Whitelist] Failed to update:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteWhitelistEntry = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await prisma.whitelistedUser.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: "Запись не найдена" });
    }
    console.error("[Whitelist] Failed to delete:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
