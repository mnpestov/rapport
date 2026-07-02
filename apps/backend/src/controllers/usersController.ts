import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { checkTelegramSubscriptionOnce } from "../utils/checkSubscription";

const SORT_FIELDS = ["firstName", "lastSeenAt", "createdAt", "favoritesCount"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;
type SortField = typeof SORT_FIELDS[number];
type SortOrder = typeof SORT_ORDERS[number];

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  const { search, limit = "50", offset = "0", sortBy = "lastSeenAt", sortOrder = "desc" } = req.query;

  const take = Math.min(parseInt(limit as string, 10) || 50, 100);
  const skip = parseInt(offset as string, 10) || 0;

  const field: SortField = SORT_FIELDS.includes(sortBy as SortField) ? (sortBy as SortField) : "lastSeenAt";
  const order: SortOrder = SORT_ORDERS.includes(sortOrder as SortOrder) ? (sortOrder as SortOrder) : "desc";
  const orderBy: any = field === "favoritesCount"
    ? { favorites: { _count: order } }
    : field === "lastSeenAt"
      ? { lastSeenAt: { sort: order, nulls: "last" } }
      : { [field]: order };

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
      orderBy,
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
