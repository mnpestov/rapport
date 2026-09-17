import { Request, Response } from "express";
import { prisma } from "../prismaClient";

/**
 * Admin dashboard/stats. All handlers are reached only through requireAuth + requireAdmin.
 * Shapes are intentionally simple scaffolding for the future admin panel;
 * richer aggregations are marked with TODO.
 */

// Свои и тестовые аккаунты (тумблер "Не учитывать в статистике" в карточке
// пользователя) не должны попадать ни в один из счётчиков/топов дашборда —
// тот же фильтр, что уже применялся только к воронке подписки
// (paywallStatsController.ts), распространён и сюда.
const EXCLUDE_TEST_USERS = { excludeFromStats: false };
const EXCLUDE_TEST_USERS_RELATION = { user: EXCLUDE_TEST_USERS };

// GET /admin/users/stats
export const getUsersStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [total, byRole] = await Promise.all([
      prisma.user.count({ where: EXCLUDE_TEST_USERS }),
      prisma.user.groupBy({ by: ["role"], where: EXCLUDE_TEST_USERS, _count: { _all: true } }),
    ]);

    res.json({
      total,
      byRole: byRole.map((r) => ({ role: r.role, count: r._count._all })),
    });
  } catch (error) {
    console.error("[Admin] getUsersStats failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/patterns/stats
export const getPatternsStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalPatterns, totalViews, totalLinkClicks] = await Promise.all([
      prisma.pattern.count(),
      prisma.patternView.count({ where: EXCLUDE_TEST_USERS_RELATION }),
      prisma.patternLinkClick.count({ where: EXCLUDE_TEST_USERS_RELATION }),
    ]);

    res.json({
      totalPatterns,
      totalViews,
      totalLinkClicks,
      // TODO: top patterns by views/clicks via prisma.patternView.groupBy({ by: ['patternId'] }).
      topPatterns: [],
    });
  } catch (error) {
    console.error("[Admin] getPatternsStats failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/dashboard
export const getDashboard = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [users, patterns, subscribeClicks] = await Promise.all([
      prisma.user.count({ where: EXCLUDE_TEST_USERS }),
      prisma.pattern.count(),
      prisma.subscribeClick.count({ where: EXCLUDE_TEST_USERS_RELATION }),
    ]);

    res.json({
      // TODO: time-series, conversion funnels, active users, etc.
      totals: { users, patterns, subscribeClicks },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Admin] getDashboard failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/dashboard/stats — full dashboard data in one request
// Query params: period='7d'|'30d'|'90d'|'all'  OR  from='YYYY-MM-DD'&to='YYYY-MM-DD'
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const { period = "all", from: fromParam, to: toParam } =
      req.query as { period?: string; from?: string; to?: string };

    const now = new Date();
    let analyticsFrom: Date | undefined;
    let analyticsTo: Date | undefined;

    if (fromParam && toParam) {
      analyticsFrom = new Date(fromParam + "T00:00:00.000Z");
      analyticsTo   = new Date(toParam   + "T23:59:59.999Z");
    } else if (period === "7d") {
      analyticsFrom = new Date(now);
      analyticsFrom.setDate(analyticsFrom.getDate() - 7);
    } else if (period === "30d") {
      analyticsFrom = new Date(now);
      analyticsFrom.setDate(analyticsFrom.getDate() - 30);
    } else if (period === "90d") {
      analyticsFrom = new Date(now);
      analyticsFrom.setDate(analyticsFrom.getDate() - 90);
    }

    // When period='all' (no date filter), new-users window stays at 7 days (legacy behaviour)
    const newUsersFrom = analyticsFrom ?? (() => {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    })();
    const createdAtRange = analyticsFrom
      ? { gte: analyticsFrom, ...(analyticsTo ? { lte: analyticsTo } : {}) }
      : undefined;
    const dateFilter = {
      ...(createdAtRange ? { createdAt: createdAtRange } : {}),
      ...EXCLUDE_TEST_USERS_RELATION,
    };
    const topWhere = dateFilter;

    // Raw SQL for author aggregation — groupBy can't aggregate across a joined
    // relation, so this joins PatternView/LinkClick/Favorite -> Pattern -> Author.
    // The (${x}::timestamptz IS NULL OR col >= ${x}) form keeps one static query
    // for both "all time" (null bounds) and a bounded period, instead of
    // conditionally building the WHERE clause as a string.
    const sqlFrom = analyticsFrom ?? null;
    const sqlTo = analyticsTo ?? null;

    type TopAuthorRow = { authorId: string; name: string; count: number };

    const [
      totalUsers,
      newUsersInPeriod,
      totalPatternViews,
      totalPatternLinkClicks,
      totalSubscribeClicks,
      totalFavorites,
      totalPriceAlerts,
      topViewsRaw,
      topLinkClicksRaw,
      topFavoritesRaw,
      topPriceAlertsRaw,
      topAuthorsByViewsRaw,
      topAuthorsByLinkClicksRaw,
      topAuthorsByFavoritesRaw,
      topSearchQueriesRaw,
    ] = await Promise.all([
      analyticsFrom
        ? prisma.user.count({ where: { lastSeenAt: { gte: analyticsFrom, ...(analyticsTo ? { lte: analyticsTo } : {}) }, ...EXCLUDE_TEST_USERS } })
        : prisma.user.count({ where: EXCLUDE_TEST_USERS }),
      prisma.user.count({ where: { createdAt: { gte: newUsersFrom, ...(analyticsTo ? { lte: analyticsTo } : {}) }, ...EXCLUDE_TEST_USERS } }),
      prisma.patternView.count({ where: dateFilter }),
      prisma.patternLinkClick.count({ where: dateFilter }),
      prisma.subscribeClick.count({ where: dateFilter }),
      prisma.userFavorite.count({ where: dateFilter }),
      prisma.priceAlert.count({ where: dateFilter }),
      prisma.patternView.groupBy({
        by: ["patternId"],
        where: topWhere,
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
        take: 10,
      }),
      prisma.patternLinkClick.groupBy({
        by: ["patternId"],
        where: topWhere,
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
        take: 10,
      }),
      prisma.userFavorite.groupBy({
        by: ["patternId"],
        where: topWhere,
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
        take: 10,
      }),
      prisma.priceAlert.groupBy({
        by: ["patternId"],
        where: topWhere,
        _count: { patternId: true },
        orderBy: { _count: { patternId: "desc" } },
        take: 10,
      }),
      prisma.$queryRaw<TopAuthorRow[]>`
        SELECT a.id as "authorId", a.name, COUNT(*)::int as count
        FROM "PatternView" v
        JOIN "Pattern" p ON p.id = v."patternId"
        JOIN "Author" a ON a.id = p."authorId"
        JOIN "User" u ON u.id = v."userId"
        WHERE (${sqlFrom}::timestamptz IS NULL OR v."createdAt" >= ${sqlFrom}::timestamptz)
          AND (${sqlTo}::timestamptz IS NULL OR v."createdAt" <= ${sqlTo}::timestamptz)
          AND u."excludeFromStats" = false
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.$queryRaw<TopAuthorRow[]>`
        SELECT a.id as "authorId", a.name, COUNT(*)::int as count
        FROM "PatternLinkClick" v
        JOIN "Pattern" p ON p.id = v."patternId"
        JOIN "Author" a ON a.id = p."authorId"
        JOIN "User" u ON u.id = v."userId"
        WHERE (${sqlFrom}::timestamptz IS NULL OR v."createdAt" >= ${sqlFrom}::timestamptz)
          AND (${sqlTo}::timestamptz IS NULL OR v."createdAt" <= ${sqlTo}::timestamptz)
          AND u."excludeFromStats" = false
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.$queryRaw<TopAuthorRow[]>`
        SELECT a.id as "authorId", a.name, COUNT(*)::int as count
        FROM "UserFavorite" v
        JOIN "Pattern" p ON p.id = v."patternId"
        JOIN "Author" a ON a.id = p."authorId"
        JOIN "User" u ON u.id = v."userId"
        WHERE (${sqlFrom}::timestamptz IS NULL OR v."createdAt" >= ${sqlFrom}::timestamptz)
          AND (${sqlTo}::timestamptz IS NULL OR v."createdAt" <= ${sqlTo}::timestamptz)
          AND u."excludeFromStats" = false
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.searchQuery.groupBy({
        by: ["query"],
        where: dateFilter,
        _count: { query: true },
        orderBy: { _count: { query: "desc" } },
        take: 10,
      }),
    ]);

    // Collect all unique patternIds we need titles for
    const allPatternIds = [
      ...new Set([
        ...topViewsRaw.map((r) => r.patternId),
        ...topLinkClicksRaw.map((r) => r.patternId),
        ...topFavoritesRaw.map((r) => r.patternId),
        ...topPriceAlertsRaw.map((r) => r.patternId),
      ]),
    ];

    const patterns = await prisma.pattern.findMany({
      where: { id: { in: allPatternIds } },
      select: { id: true, title: true, url: true, author: { select: { name: true } } },
    });
    const patternMap = new Map(patterns.map((p) => [p.id, p]));

    const toTopList = (raw: { patternId: string; _count: { patternId: number } }[]) =>
      raw.map((r) => {
        const p = patternMap.get(r.patternId);
        return {
          patternId: r.patternId,
          title: p?.title ?? "—",
          authorName: p?.author.name ?? "—",
          url: p?.url ?? "",
          count: r._count.patternId,
        };
      });

    res.json({
      stats: {
        totalUsers,
        newUsersInPeriod,
        totalPatternViews,
        totalPatternLinkClicks,
        totalSubscribeClicks,
        totalFavorites,
        totalPriceAlerts,
      },
      topByViews: toTopList(topViewsRaw),
      topByLinkClicks: toTopList(topLinkClicksRaw),
      topByFavorites: toTopList(topFavoritesRaw),
      topByPriceAlerts: toTopList(topPriceAlertsRaw),
      topAuthorsByViews: topAuthorsByViewsRaw,
      topAuthorsByLinkClicks: topAuthorsByLinkClicksRaw,
      topAuthorsByFavorites: topAuthorsByFavoritesRaw,
      topSearchQueries: topSearchQueriesRaw.map((r) => ({
        query: r.query,
        count: r._count.query,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Admin] getDashboardStats failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/patterns/:id/price-alert-subscribers — кто подписался на
// снижение цены конкретного описания (детализация плашки "Топ по подписке
// на цену" на дашборде). Форма ответа { total, items } намеренно та же,
// что у getPaywallStatsUsers (PaywallStatsUser[]) — переиспользует готовую
// PaywallUsersModal вместо отдельного компонента-таблицы.
export const getPatternPriceAlertSubscribers = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const subscriptions = await prisma.priceAlert.findMany({
      where: { patternId: id, ...EXCLUDE_TEST_USERS_RELATION },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        user: {
          select: {
            id: true,
            telegramId: true,
            firstName: true,
            lastName: true,
            username: true,
          },
        },
      },
    });

    res.json({
      total: subscriptions.length,
      items: subscriptions.map((s) => ({
        userId: s.user.id,
        telegramId: s.user.telegramId.toString(),
        firstName: s.user.firstName,
        lastName: s.user.lastName,
        username: s.user.username,
        count: 1,
        lastAt: s.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[Admin] getPatternPriceAlertSubscribers failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/users/activity-segments — «реальная» аудитория, в отличие от
// голого count(User) на вкладке пользователей. Единственный надёжный сигнал
// вовлечённости в этом продукте — факт просмотра карточки (PatternView), а
// не lastSeenAt: то поле проставляется и при пустом заходе без единого
// действия в каталоге. Дорогой запрос (сканирует PatternView целиком) —
// вызывается только вручную кнопкой "Обновить" на странице статистики, не
// на каждый рендер.
export const getUserActivitySegments = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [segments, weekly, cohorts] = await Promise.all([
      prisma.$queryRaw<
        { segment: string; count: bigint }[]
      >`
        WITH stats AS (
          SELECT
            u.id,
            v.last_view,
            u."premiumExpiresAt" > now() AS sub_active
          FROM "User" u
          LEFT JOIN (
            SELECT "userId", MAX("createdAt") AS last_view FROM "PatternView" GROUP BY "userId"
          ) v ON v."userId" = u.id
          WHERE u."excludeFromStats" = false
        )
        SELECT
          CASE
            WHEN sub_active THEN 'paid'
            WHEN last_view IS NULL THEN 'dead'
            WHEN last_view >= now() - interval '30 days' THEN 'active'
            WHEN last_view >= now() - interval '90 days' THEN 'sleeping'
            ELSE 'churned'
          END AS segment,
          COUNT(*) AS count
        FROM stats
        GROUP BY 1
      `,
      // Регистрации и реальная активность по неделям — тот же срез, что в
      // дашборде реактивации (последние 16 недель, включая текущую).
      prisma.$queryRaw<
        { week: Date; new_users: bigint; active_users: bigint }[]
      >`
        SELECT
          weeks.week,
          COALESCE(nu.cnt, 0) AS new_users,
          COALESCE(au.cnt, 0) AS active_users
        FROM (
          SELECT date_trunc('week', d)::date AS week
          FROM generate_series(date_trunc('week', now()) - interval '15 weeks', date_trunc('week', now()), interval '1 week') d
        ) weeks
        LEFT JOIN (
          SELECT date_trunc('week', "createdAt")::date AS week, COUNT(*) AS cnt
          FROM "User" WHERE "excludeFromStats" = false GROUP BY 1
        ) nu ON nu.week = weeks.week
        LEFT JOIN (
          SELECT date_trunc('week', "lastSeenAt")::date AS week, COUNT(*) AS cnt
          FROM "User" WHERE "excludeFromStats" = false AND "lastSeenAt" IS NOT NULL GROUP BY 1
        ) au ON au.week = weeks.week
        ORDER BY weeks.week
      `,
      // Когортное удержание: доля каждой недельной когорты регистрации,
      // вернувшаяся позже 7 дней после регистрации. Последние 2 недели
      // включаются, но фронт помечает их как "рано судить".
      prisma.$queryRaw<
        { week: Date; cohort_size: bigint; returned_d7plus: bigint }[]
      >`
        SELECT
          date_trunc('week', u."createdAt")::date AS week,
          COUNT(*) AS cohort_size,
          COUNT(*) FILTER (WHERE u."lastSeenAt" > u."createdAt" + interval '7 days') AS returned_d7plus
        FROM "User" u
        WHERE u."excludeFromStats" = false
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

    const segmentCounts: Record<string, number> = { paid: 0, active: 0, sleeping: 0, dead: 0, churned: 0 };
    for (const row of segments) segmentCounts[row.segment] = Number(row.count);

    res.json({
      segments: segmentCounts,
      weekly: weekly.map((w) => ({
        week: w.week.toISOString().slice(0, 10),
        newUsers: Number(w.new_users),
        activeUsers: Number(w.active_users),
      })),
      cohorts: cohorts.map((c) => ({
        week: c.week.toISOString().slice(0, 10),
        cohortSize: Number(c.cohort_size),
        returnedD7Plus: Number(c.returned_d7plus),
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Admin] getUserActivitySegments failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
