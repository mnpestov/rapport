import { Request, Response } from "express";
import { prisma } from "../prismaClient";

/**
 * Admin dashboard/stats. All handlers are reached only through requireAuth + requireAdmin.
 * Shapes are intentionally simple scaffolding for the future admin panel;
 * richer aggregations are marked with TODO.
 */

// GET /admin/users/stats
export const getUsersStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [total, byRole] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
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
      prisma.patternView.count(),
      prisma.patternLinkClick.count(),
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
      prisma.user.count(),
      prisma.pattern.count(),
      prisma.subscribeClick.count(),
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
    const dateFilter = createdAtRange ? { createdAt: createdAtRange } : undefined;
    const topWhere = createdAtRange
      ? { createdAt: { ...createdAtRange } }
      : undefined;

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
      topViewsRaw,
      topLinkClicksRaw,
      topFavoritesRaw,
      topAuthorsByViewsRaw,
      topAuthorsByLinkClicksRaw,
      topAuthorsByFavoritesRaw,
      topSearchQueriesRaw,
    ] = await Promise.all([
      analyticsFrom
        ? prisma.user.count({ where: { lastSeenAt: { gte: analyticsFrom, ...(analyticsTo ? { lte: analyticsTo } : {}) } } })
        : prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: newUsersFrom, ...(analyticsTo ? { lte: analyticsTo } : {}) } } }),
      prisma.patternView.count({ where: dateFilter }),
      prisma.patternLinkClick.count({ where: dateFilter }),
      prisma.subscribeClick.count({ where: dateFilter }),
      prisma.userFavorite.count({ where: dateFilter }),
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
      prisma.$queryRaw<TopAuthorRow[]>`
        SELECT a.id as "authorId", a.name, COUNT(*)::int as count
        FROM "PatternView" v
        JOIN "Pattern" p ON p.id = v."patternId"
        JOIN "Author" a ON a.id = p."authorId"
        WHERE (${sqlFrom}::timestamptz IS NULL OR v."createdAt" >= ${sqlFrom}::timestamptz)
          AND (${sqlTo}::timestamptz IS NULL OR v."createdAt" <= ${sqlTo}::timestamptz)
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.$queryRaw<TopAuthorRow[]>`
        SELECT a.id as "authorId", a.name, COUNT(*)::int as count
        FROM "PatternLinkClick" v
        JOIN "Pattern" p ON p.id = v."patternId"
        JOIN "Author" a ON a.id = p."authorId"
        WHERE (${sqlFrom}::timestamptz IS NULL OR v."createdAt" >= ${sqlFrom}::timestamptz)
          AND (${sqlTo}::timestamptz IS NULL OR v."createdAt" <= ${sqlTo}::timestamptz)
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.$queryRaw<TopAuthorRow[]>`
        SELECT a.id as "authorId", a.name, COUNT(*)::int as count
        FROM "UserFavorite" v
        JOIN "Pattern" p ON p.id = v."patternId"
        JOIN "Author" a ON a.id = p."authorId"
        WHERE (${sqlFrom}::timestamptz IS NULL OR v."createdAt" >= ${sqlFrom}::timestamptz)
          AND (${sqlTo}::timestamptz IS NULL OR v."createdAt" <= ${sqlTo}::timestamptz)
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
      },
      topByViews: toTopList(topViewsRaw),
      topByLinkClicks: toTopList(topLinkClicksRaw),
      topByFavorites: toTopList(topFavoritesRaw),
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
