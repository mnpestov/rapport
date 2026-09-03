import cron from "node-cron";
import { prisma } from "../prismaClient";
import { sendPriceDropAlert } from "../services/priceAlertNotifier";

// Рассылка уведомлений о снижении цены подписчикам
// (implementation_plan.md — «Подписка на цены»).
//
// Разбирает PriceCheckRun с alertsDispatchedAt IS NULL, по каждой записи —
// фильтрует снижения цены в changes[], находит подписчиков с активным
// PRICE_ALERT, шлёт уведомления, помечает запись обработанной.

interface ChangeRow {
  patternId?: string | null;
  title?: string | null;
  oldPrice?: number | null;
  newPrice?: number | null;
  // oldOldPrice/newOldPrice (зачёркнутые цены) для фильтра НЕ используются.
}

// Снижение = новая фактическая цена ниже предыдущей, обе заданы и > 0.
// Переход в «бесплатно» (newPrice = 0/null) — не уведомляем.
function isPriceDrop(row: ChangeRow): row is ChangeRow & {
  patternId: string;
  oldPrice: number;
  newPrice: number;
} {
  return (
    row.patternId != null &&
    row.newPrice != null &&
    row.newPrice > 0 &&
    row.oldPrice != null &&
    row.newPrice < row.oldPrice
  );
}

export async function dispatchPriceAlerts(): Promise<void> {
  const runs = await prisma.priceCheckRun.findMany({
    where: { alertsDispatchedAt: null },
    orderBy: { startedAt: "asc" },
    select: { id: true, changes: true },
  });

  for (const run of runs) {
    const rows: ChangeRow[] = Array.isArray(run.changes)
      ? (run.changes as unknown as ChangeRow[])
      : [];

    for (const row of rows) {
      if (!isPriceDrop(row)) continue;

      // Один запрос на паттерн вместо N в цикле. Проверка PRICE_ALERT через
      // include — тот же приём, что в requirePermissionOrAdmin.
      const alerts = await prisma.priceAlert.findMany({
        where: { patternId: row.patternId },
        include: {
          user: {
            select: {
              telegramId: true,
              permissions: {
                where: { permission: "PRICE_ALERT" },
                select: { id: true },
              },
            },
          },
        },
      });

      const eligible = alerts.filter((a) => a.user.permissions.length > 0);
      for (const alert of eligible) {
        await sendPriceDropAlert(
          alert.user.telegramId,
          row.title ?? "Описание",
          row.oldPrice,
          row.newPrice,
          row.patternId,
        );
      }
    }

    // Ставится после всей рассылки по записи, независимо от частичных
    // ошибок Gateway (sendPriceDropAlert не бросает).
    await prisma.priceCheckRun.update({
      where: { id: run.id },
      data: { alertsDispatchedAt: new Date() },
    });
  }
}

// Single rapport-api instance (no pm2 cluster mode) — safe to schedule
// in-process without a distributed lock.
export function startPriceAlertDispatcherJob(): void {
  dispatchPriceAlerts().catch((err) =>
    console.error("[priceAlertDispatcher] initial run failed:", err),
  );

  cron.schedule("*/15 * * * *", () => {
    dispatchPriceAlerts().catch((err) =>
      console.error("[priceAlertDispatcher] scheduled run failed:", err),
    );
  });
}
