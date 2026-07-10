import { Request, Response } from "express";
import { Permission, UserRole } from "@prisma/client";
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
        role: true,
        authorId: true,
        author: { select: { id: true, name: true } },
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

export const getUserById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      telegramId: true,
      firstName: true,
      lastName: true,
      username: true,
      languageCode: true,
      isPremium: true,
      role: true,
      authorId: true,
      author: { select: { id: true, name: true } },
      permissions: { select: { permission: true } },
      createdAt: true,
      lastSeenAt: true,
      platform: true,
      tgVersion: true,
      userAgent: true,
      _count: { select: { favorites: true } },
    },
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    ...user,
    telegramId: user.telegramId.toString(),
    favoritesCount: user._count.favorites,
    permissions: user.permissions.map((p) => p.permission),
  });
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { role, authorId } = req.body as { role?: UserRole; authorId?: string | null };

  if (role !== undefined && !Object.values(UserRole).includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  if (role === UserRole.AUTHOR && !authorId) {
    res.status(400).json({ error: "authorId is required when role is AUTHOR" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(role !== undefined ? { role } : {}),
          ...(authorId !== undefined ? { authorId: authorId ?? null } : {}),
        },
      });

      if (role === UserRole.AUTHOR) {
        await tx.userPermission.upsert({
          where: { userId_permission: { userId: id, permission: Permission.AUTHOR_CABINET } },
          create: { userId: id, permission: Permission.AUTHOR_CABINET },
          update: {},
        });
      } else if (role !== undefined) {
        await tx.userPermission.deleteMany({
          where: { userId: id, permission: Permission.AUTHOR_CABINET },
        });
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (error.code === "P2002") {
      res.status(409).json({ error: "This author is already linked to another user" });
      return;
    }
    if (error.code === "P2003") {
      res.status(404).json({ error: "Author not found" });
      return;
    }
    console.error("[Admin] updateUser failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
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
