import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { checkTelegramSubscriptionOnce } from "../utils/checkSubscription";

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  const { search, limit = "50", offset = "0" } = req.query;

  const take = Math.min(parseInt(limit as string, 10) || 50, 100);
  const skip = parseInt(offset as string, 10) || 0;

  const where: any = {};
  if (search && typeof search === "string") {
    const q = search.trim();
    const conditions: any[] = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { username: { contains: q, mode: "insensitive" } },
    ];
    try {
      conditions.push({ telegramId: BigInt(q) });
    } catch { /* not numeric */ }
    where.OR = conditions;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      take,
      skip,
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        lastName: true,
        username: true,
        languageCode: true,
        isPremium: true,
        createdAt: true,
        lastSeenAt: true,
        platform: true,
        tgVersion: true,
        userAgent: true,
        _count: { select: { favorites: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    data: users.map((u) => ({
      ...u,
      telegramId: u.telegramId.toString(),
      favoritesCount: u._count.favorites,
    })),
    total,
  });
};

export const getUserSubscription = async (req: Request, res: Response): Promise<void> => {
  const { telegramId } = req.params;
  const num = Number(telegramId);
  if (!Number.isFinite(num)) {
    res.status(400).json({ error: "Invalid telegramId" });
    return;
  }
  const isSubscribed = await checkTelegramSubscriptionOnce(num);
  res.json({ isSubscribed });
};
