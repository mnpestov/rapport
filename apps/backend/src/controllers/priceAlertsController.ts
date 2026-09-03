import { Request, Response } from "express";
import { prisma } from "../prismaClient";

// Подписка пользователя на снижение цены описания
// (implementation_plan.md — «Подписка на цены»).

// Лимит активных подписок на пользователя. Проверка count() >= LIMIT не
// атомарна — два параллельных POST от одного пользователя могут создать
// LIMIT+1 запись. Для этой фичи (человек, одна сессия) терпимо.
const MAX_ALERTS_PER_USER = 20;

// GET /price-alerts — patternId[] активных подписок пользователя
export const getAlerts = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const alerts = await prisma.priceAlert.findMany({
      where: { userId },
      select: { patternId: true },
    });
    res.json({ patternIds: alerts.map((a: { patternId: string }) => a.patternId) });
  } catch (error) {
    console.error("[PriceAlerts] Failed to get alerts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /price-alerts/:patternId — подписаться
export const subscribeAlert = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { patternId } = req.params;

  try {
    const pattern = await prisma.pattern.findUnique({ where: { id: patternId } });
    if (!pattern) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    const count = await prisma.priceAlert.count({ where: { userId } });
    if (count >= MAX_ALERTS_PER_USER) {
      // Читаемый текст — фронт показывает его под кнопкой (не тост).
      res.status(429).json({ error: `Достигнут лимит подписок (${MAX_ALERTS_PER_USER})` });
      return;
    }

    await prisma.priceAlert.upsert({
      where: { userId_patternId: { userId, patternId } },
      update: {}, // no-op если уже есть
      create: { userId, patternId },
    });

    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("[PriceAlerts] Failed to subscribe:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /price-alerts/:patternId — отписаться
export const unsubscribeAlert = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { patternId } = req.params;

  try {
    await prisma.priceAlert.deleteMany({ where: { userId, patternId } });
    res.json({ ok: true });
  } catch (error) {
    console.error("[PriceAlerts] Failed to unsubscribe:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
