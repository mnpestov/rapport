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

// Свои и тестовые аккаунты не должны попадать в воронку — иначе на малых
// числах они заметно искажают конверсию. Фильтр применяется В КАЖДОМ
// запросе этого файла: пропусти его в одном месте, и виджет разойдётся со
// своей же детализацией. Влияет только на воронку, не на дашборд.
const EXCLUDE_TEST_USERS = { user: { excludeFromStats: false } };

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
      ...EXCLUDE_TEST_USERS,
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
const ACQUISITION_SOURCES: PaywallSource[] = [
  PaywallSource.AUTO_BANNER,
  PaywallSource.SEARCH_BUTTON,
  // Замок на платной секции фильтров — тоже привлечение: доступа у человека
  // нет, знаменатель тот же.
  PaywallSource.FILTER_LOCK,
];
// Разрезы внутри привлечения: обе поверхности пользователь открывает сам,
// но приходит с разным намерением — из фильтров за конкретной функцией, с
// кнопки у поиска просто посмотреть, что даёт подписка. Отдельные счётчики
// нужны, чтобы это было видно, а не тонуло в общей цифре.
const FILTER_LOCK_SOURCES: PaywallSource[] = [PaywallSource.FILTER_LOCK];
const SEARCH_BUTTON_SOURCES: PaywallSource[] = [PaywallSource.SEARCH_BUTTON];

const RETENTION_SOURCES: PaywallSource[] = [
  PaywallSource.EXPIRING_3_DAYS,
  PaywallSource.EXPIRING_1_DAY,
  PaywallSource.ACTIVE,
];
// Именно для шага "показали баннер" ACTIVE исключён: в PaywallModal.tsx
// variant='active' выставляется ТОЛЬКО при ручном открытии кнопкой у
// поиска (App.tsx onOpenPaywall) — автопоказа с этим вариантом в коде не
// существует. Значит source=ACTIVE на SHOWN — это всегда "пользователь сам
// открыл", а не "мы показали". Клик/оплату при этом всё ещё считаем по
// полному RETENTION_SOURCES — воронка ниже верхнего шага не должна терять
// людей, продливших подписку вручную.
const RETENTION_AUTO_SHOWN_SOURCES: PaywallSource[] = [
  PaywallSource.EXPIRING_3_DAYS,
  PaywallSource.EXPIRING_1_DAY,
];

async function countPayingUsers(
  range: { from?: Date; to?: Date },
  sources: PaywallSource[]
): Promise<number> {
  const rows = await prisma.payment.findMany({
    where: {
      status: "PAID",
      ...EXCLUDE_TEST_USERS,
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

// Верх воронки "Удержание" — не показы баннера, а платные подписчики за
// период: те, у кого подписка была активна хотя бы день в выбранном
// диапазоне. premiumExpiresAt — единственная метка подписки на User (нет
// subscriptionStartedAt), поэтому "активна в период" проверяется только
// снизу: подписка не истекла до начала периода. Верхняя граница диапазона
// не нужна — подписчик, чья подписка истекает уже ПОСЛЕ периода, всё равно
// была активна внутри него.
async function countActiveSubscribers(range: { from?: Date; to?: Date }): Promise<number> {
  return prisma.user.count({
    where: {
      excludeFromStats: false,
      premiumExpiresAt: { gte: range.from ?? new Date(0) },
    },
  });
}

// "Отказались" — подписка истекла В ВЫБРАННЫЙ ПЕРИОД и сейчас всё ещё не
// активна (не продлили после истечения). Обе границы обязательны:
// premiumExpiresAt внутри [range.from, range.to] — иначе, например, при
// period=all сюда попал бы вообще любой когда-либо переставший быть
// подписчиком, без привязки к периоду. range.to по умолчанию — текущий
// момент (period без явного "to", т.е. 7d/30d/90d/all).
async function countChurnedSubscribers(range: { from?: Date; to?: Date }): Promise<number> {
  const now = new Date();
  // "Сейчас не активна" — верхняя граница периода не может быть позже
  // текущего момента: если period.to в будущем (или не задан), реальный
  // предел всё равно now().
  const upperBound = range.to && range.to < now ? range.to : now;
  return prisma.user.count({
    where: {
      excludeFromStats: false,
      premiumExpiresAt: { gte: range.from ?? new Date(0), lt: upperBound },
    },
  });
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
      buttonOpenedFromFilters,
      acquisitionShown,
      acquisitionClick,
      acquisitionPaid,
      retentionActiveSubscribers,
      retentionShown,
      retentionClick,
      retentionPaid,
      churnedSubscribers,
      // Платежи без источника — созданные до появления аналитики. Показываем
      // отдельно, чтобы сумма по воронкам не выглядела расходящейся с общим
      // числом оплат.
      paidWithoutSource,
    ] = await Promise.all([
      countUniqueUsers(PaywallEventType.SHOWN, range),
      countUniqueUsers(PaywallEventType.SCROLLED_TO_END, range),
      countUniqueUsers(PaywallEventType.SUBSCRIBE_CLICK, range),
      countUniqueUsers(PaywallEventType.CLOSED, range),
      // Именно кнопка у поиска, а не все ручные открытия: с появлением
      // замков в фильтрах BUTTON_OPENED приходит из двух мест, и общая
      // цифра под подписью «кнопкой у поиска» была бы неверной.
      countUniqueUsers(PaywallEventType.BUTTON_OPENED, range, SEARCH_BUTTON_SOURCES),
      countUniqueUsers(PaywallEventType.BUTTON_OPENED, range, FILTER_LOCK_SOURCES),

      countUniqueUsers(PaywallEventType.SHOWN, range, ACQUISITION_SOURCES),
      countUniqueUsers(PaywallEventType.SUBSCRIBE_CLICK, range, ACQUISITION_SOURCES),
      countPayingUsers(range, ACQUISITION_SOURCES),

      countActiveSubscribers(range),
      countUniqueUsers(PaywallEventType.SHOWN, range, RETENTION_AUTO_SHOWN_SOURCES),
      countUniqueUsers(PaywallEventType.SUBSCRIBE_CLICK, range, RETENTION_SOURCES),
      countPayingUsers(range, RETENTION_SOURCES),
      countChurnedSubscribers(range),

      prisma.payment.count({
        where: {
          status: "PAID",
          ...EXCLUDE_TEST_USERS,
          source: null,
          ...(range.from || range.to
            ? { paidAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
            : {}),
        },
      }),
    ]);

    res.json({
      events: { shown, scrolledToEnd, subscribeClick, closed, buttonOpened, buttonOpenedFromFilters },
      acquisition: { shown: acquisitionShown, subscribeClick: acquisitionClick, paid: acquisitionPaid },
      retention: {
        activeSubscribers: retentionActiveSubscribers,
        shown: retentionShown,
        subscribeClick: retentionClick,
        paid: retentionPaid,
      },
      // Сводка для шапки виджета — не часть воронки удержания: "сколько
      // сейчас платят" и "сколько ушло за период", а не шаги конверсии.
      summary: {
        activeSubscribers: retentionActiveSubscribers,
        churnedSubscribers,
      },
      paidWithoutSource,
    });
  } catch (error) {
    console.error("[PaywallStats] Failed to compute:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ── Детализация: кто именно попал в метрику ──────────────────────────────
// Цифра без имён отвечает "сколько", но не "кто" — а разбираться обычно
// нужно именно со вторым. Возвращает постранично список пользователей,
// стоящих за конкретным числом на дашборде.

const SCOPE_SOURCES: Record<string, PaywallSource[] | undefined> = {
  all: undefined,
  acquisition: ACQUISITION_SOURCES,
  retention: RETENTION_SOURCES,
  // Тот же смысл, что RETENTION_AUTO_SHOWN_SOURCES выше — drilldown по
  // шагу "показали баннер продления" должен вести тех же людей, что попали
  // в саму цифру (без ручных открытий с source=ACTIVE).
  retention_auto_shown: RETENTION_AUTO_SHOWN_SOURCES,
  filter_lock: FILTER_LOCK_SOURCES,
  search_button: SEARCH_BUTTON_SOURCES,
};

// GET /admin/paywall-stats/users?metric=SHOWN|...|PAID
//   &scope=all|acquisition|retention|retention_auto_shown|filter_lock|search_button
export const getPaywallStatsUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parsePeriod(req);
    const { metric, scope = "all", limit = "50", offset = "0", sortOrder = "desc" } = req.query as Record<string, string>;
    const order = sortOrder === "asc" ? "asc" : "desc";

    const take = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = parseInt(offset, 10) || 0;
    const sources = SCOPE_SOURCES[scope];

    const createdAtFilter =
      range.from || range.to
        ? { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) }
        : undefined;

    // "Оплатили" живёт в Payment, а не в логе событий — отдельная ветка.
    if (metric === "PAID") {
      const where = {
        status: "PAID" as const,
        ...EXCLUDE_TEST_USERS,
        ...(sources ? { source: { in: sources } } : {}),
        ...(createdAtFilter ? { paidAt: createdAtFilter } : {}),
      };
      const [payments, distinctUsers] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: { paidAt: "desc" },
          take,
          skip,
          include: {
            user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true } },
          },
        }),
        prisma.payment.findMany({ where, select: { userId: true }, distinct: ["userId"] }),
      ]);

      res.json({
        total: distinctUsers.length,
        items: payments.map((p) => ({
          userId: p.user.id,
          telegramId: p.user.telegramId.toString(),
          firstName: p.user.firstName,
          lastName: p.user.lastName,
          username: p.user.username,
          count: 1,
          lastAt: p.paidAt?.toISOString() ?? null,
          amount: Number(p.amount),
          invId: p.invId,
        })),
      });
      return;
    }

    // "Платные подписчики" — верх воронки удержания, это User по
    // premiumExpiresAt, а не PaywallEvent/Payment — третья отдельная ветка,
    // тот же критерий "активна хотя бы день в периоде", что в
    // countActiveSubscribers выше.
    if (metric === "ACTIVE_SUBSCRIBERS") {
      const where = {
        excludeFromStats: false,
        premiumExpiresAt: { gte: range.from ?? new Date(0) },
      };
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { premiumExpiresAt: order },
          take,
          skip,
          select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, premiumExpiresAt: true },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        total,
        items: users.map((u) => ({
          userId: u.id,
          telegramId: u.telegramId.toString(),
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
          count: 1,
          lastAt: u.premiumExpiresAt?.toISOString() ?? null,
        })),
      });
      return;
    }

    // "Отказались" — тот же критерий, что countChurnedSubscribers выше:
    // подписка истекла внутри периода и сейчас не активна.
    if (metric === "CHURNED_SUBSCRIBERS") {
      const now = new Date();
      const upperBound = range.to && range.to < now ? range.to : now;
      const where = {
        excludeFromStats: false,
        premiumExpiresAt: { gte: range.from ?? new Date(0), lt: upperBound },
      };
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { premiumExpiresAt: order },
          take,
          skip,
          select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, premiumExpiresAt: true },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        total,
        items: users.map((u) => ({
          userId: u.id,
          telegramId: u.telegramId.toString(),
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
          count: 1,
          lastAt: u.premiumExpiresAt?.toISOString() ?? null,
        })),
      });
      return;
    }

    if (!(Object.values(PaywallEventType) as string[]).includes(metric)) {
      res.status(400).json({ error: "Unknown metric" });
      return;
    }

    const where = {
      type: metric as PaywallEventType,
      ...EXCLUDE_TEST_USERS,
      ...(sources ? { source: { in: sources } } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    };

    // groupBy, а не findMany+distinct: нужен ещё и счётчик событий на
    // пользователя (сколько раз видел баннер) и время последнего — по одной
    // строке на человека, как и в самой метрике.
    const [grouped, allGroups] = await Promise.all([
      prisma.paywallEvent.groupBy({
        by: ["userId"],
        where,
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: "desc" } },
        take,
        skip,
      }),
      prisma.paywallEvent.findMany({ where, select: { userId: true }, distinct: ["userId"] }),
    ]);

    const users = await prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: { id: true, telegramId: true, firstName: true, lastName: true, username: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    res.json({
      total: allGroups.length,
      items: grouped.map((g) => {
        const u = byId.get(g.userId);
        return {
          userId: g.userId,
          telegramId: u?.telegramId.toString() ?? "—",
          firstName: u?.firstName ?? "—",
          lastName: u?.lastName ?? null,
          username: u?.username ?? null,
          count: g._count._all,
          lastAt: g._max.createdAt?.toISOString() ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("[PaywallStats] Failed to list users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
