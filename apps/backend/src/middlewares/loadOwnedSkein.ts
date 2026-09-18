import { Request, Response, NextFunction } from "express";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";

/**
 * Загрузка владения StashSkein (YARN_STASH_PLAN.md §3, "Проверка владения —
 * единый middleware"). Не полагаемся на дисциплину "каждый хендлер обязан
 * проверить сам" — все :id-роуты хранилища проходят через один и тот же
 * middleware.
 *
 * Возвращает 404, не 403, на чужую запись — чтобы не подтверждать
 * существование чужого id открытым текстом (утечка перечислением).
 *
 * ADMIN обходит проверку владения (видит любую запись) — тот же принцип,
 * что у requirePermissionOrAdmin. Роль читается из БД, а не из req.user:
 * JwtPayload (utils/jwt.ts) вообще не содержит поля role — попытка
 * проверить req.user.role напрямую тихо всегда была бы undefined !== ADMIN,
 * и ADMIN бы потерял доступ к чужим записям без единой ошибки в логах
 * (план §5.10, известный класс бага). Тот же путь чтения роли, что уже
 * использует requireAdmin/requirePermissionOrAdmin.
 */
declare global {
  namespace Express {
    interface Request {
      skein?: Prisma.StashSkeinGetPayload<Record<string, never>>;
    }
  }
}

export const loadOwnedSkein = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const [user, skein] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.stashSkein.findUnique({ where: { id } }),
    ]);

    if (!skein) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const isAdmin = user?.role === UserRole.ADMIN;
    if (!isAdmin && skein.userId !== userId) {
      // Чужая запись — 404, не 403: не раскрываем сам факт существования id.
      res.status(404).json({ error: "Not found" });
      return;
    }

    req.skein = skein;
    next();
  } catch (error) {
    console.error("[loadOwnedSkein] Failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Тот же принцип, для роутов, оперирующих StashSwatch/StashUsage по их
 * собственному :id (не по :id родительского StashSkein) — владение
 * проверяется транзитивно через родительский skein. Кладёт найденный
 * swatch/usage в req.swatch/req.usage вместе с req.skein (родитель),
 * чтобы хендлер не делал повторный запрос.
 */
declare global {
  namespace Express {
    interface Request {
      swatch?: Prisma.StashSwatchGetPayload<Record<string, never>>;
      usage?: Prisma.StashUsageGetPayload<Record<string, never>>;
    }
  }
}

export const loadOwnedSwatch = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const [user, swatch] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.stashSwatch.findUnique({ where: { id }, include: { skein: true } }),
    ]);

    if (!swatch) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const isAdmin = user?.role === UserRole.ADMIN;
    if (!isAdmin && swatch.skein.userId !== userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    req.swatch = swatch;
    req.skein = swatch.skein;
    next();
  } catch (error) {
    console.error("[loadOwnedSwatch] Failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const loadOwnedUsage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const [user, usage] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.stashUsage.findUnique({ where: { id }, include: { skein: true } }),
    ]);

    if (!usage) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const isAdmin = user?.role === UserRole.ADMIN;
    if (!isAdmin && usage.skein.userId !== userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    req.usage = usage;
    req.skein = usage.skein;
    next();
  } catch (error) {
    console.error("[loadOwnedUsage] Failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
