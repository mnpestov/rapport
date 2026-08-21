import { Request, Response } from "express";
import { PaywallEventType, PaywallSource } from "@prisma/client";
import { prisma } from "../prismaClient";

// Разбор периода — тот же контракт, что у getDashboardStats
// (period=7d|30d|90d|all или from/to), чтобы виджет воронки подчинялся
// общему переключателю на дашборде, а не заводил свой (§10.2).
function parsePeriod(req: Request): { from?: Date; to?: Date } {
  const { period = "all", from: fromParam, to: toParam } =
    req.query as { period?: string; from?: string; to?: string };

  if (fromParam && toParam) {
    return {
      from: new Date(fromParam + "T00:00:00.000Z"),
      to: new Date(toParam + "T23:59:59.999Z"),
    };
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : null;
  if (days === null) return {};
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from };
}

// Считаем УНИКАЛЬНЫХ пользователей, а не события: один человек видит баннер
// ~4 раза в месяц, и если верх воронки мерить показами, а низ — людьми,
// конверсия окажется занижена в разы (§10.2). distinct на userId.
async function countUniqueUsers(
  type: PaywallEventType,
  range: { from?: Date; to?: Date },
  sources?: PaywallSource[]
): Promise<number> {
  const rows = await prisma.paywallEvent.findMany({
    where: {
      type,
      ...(sources ? { source: { in: sources } } : {}),
      ...(range.from || range.to
        ? { createdAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
        : {}),
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.length;
}

// Привлечение и удержание — разные воронки: у них разный знаменатель и
// разный смысл, складывать нельзя (§10.3). ACQUISITION — те, у кого доступа
// нет; RETENTION — продление действующей или истекающей подписки.
const ACQUISITION_SOURCES: PaywallSource[] = [PaywallSource.AUTO_BANNER, PaywallSource.SEARCH_BUTTON];
const RETENTION_SOURCES: PaywallSource[] = [
  PaywallSource.EXPIRING_3_DAYS,
  PaywallSource.EXPIRING_1_DAY,
  PaywallSource.ACTIVE,
];

async function countPayingUsers(
  range: { from?: Date; to?: Date },
  sources: PaywallSource[]
): Promise<number> {
  const rows = await prisma.payment.findMany({
    where: {
      status: "PAID",
      source: { in: sources },
      ...(range.from || range.to
        ? { paidAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
        : {}),
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.length;
}

// GET /admin/paywall-stats
export const getPaywallStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parsePeriod(req);

    const [
      shown,
      scrolledToEnd,
      subscribeClick,
      closed,
      buttonOpened,
      acquisitionShown,
      acquisitionClick,
      acquisitionPaid,
      retentionShown,
      retentionClick,
      retentionPaid,
      // Платежи без источника — созданные до появления аналитики. Показываем
      // отдельно, чтобы сумма по воронкам не выглядела расходящейся с общим
      // числом оплат.
      paidWithoutSource,
    ] = await Promise.all([
      countUniqueUsers(PaywallEventType.SHOWN, range),
      countUniqueUsers(PaywallEventType.SCROLLED_TO_END, range),
      countUniqueUsers(PaywallEventType.SUBSCRIBE_CLICK, range),
      countUniqueUsers(PaywallEventType.CLOSED, range),
      countUniqueUsers(PaywallEventType.BUTTON_OPENED, range),

      countUniqueUsers(PaywallEventType.SHOWN, range, ACQUISITION_SOURCES),
      countUniqueUsers(PaywallEventType.SUBSCRIBE_CLICK, range, ACQUISITION_SOURCES),
      countPayingUsers(range, ACQUISITION_SOURCES),

      countUniqueUsers(PaywallEventType.SHOWN, range, RETENTION_SOURCES),
      countUniqueUsers(PaywallEventType.SUBSCRIBE_CLICK, range, RETENTION_SOURCES),
      countPayingUsers(range, RETENTION_SOURCES),

      prisma.payment.count({
        where: {
          status: "PAID",
          source: null,
          ...(range.from || range.to
            ? { paidAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
            : {}),
        },
      }),
    ]);

    res.json({
      events: { shown, scrolledToEnd, subscribeClick, closed, buttonOpened },
      acquisition: { shown: acquisitionShown, subscribeClick: acquisitionClick, paid: acquisitionPaid },
      retention: { shown: retentionShown, subscribeClick: retentionClick, paid: retentionPaid },
      paidWithoutSource,
    });
  } catch (error) {
    console.error("[PaywallStats] Failed to compute:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
