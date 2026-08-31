import { prisma } from "../prismaClient";
import type { EventPlatform } from "../utils/requestPlatform";

/**
 * Analytics persistence. Controllers handle HTTP (validation, status codes);
 * all DB writes live here so ingestion logic can be reused/tested in isolation.
 * userId always originates from the JWT — never from the request body.
 *
 * platform — тоже из токена (см. requestPlatform): без него события
 * браузерной версии неотличимы от Telegram и воронка смешивает две разные
 * аудитории (BROWSER_ACCESS_PLAN.md §4.5, P2).
 */
export const AnalyticsService = {
  recordPatternView(userId: string, patternId: string, platform: EventPlatform) {
    return prisma.patternView.create({ data: { userId, patternId, platform } });
  },

  recordPatternLinkClick(userId: string, patternId: string, platform: EventPlatform) {
    return prisma.patternLinkClick.create({ data: { userId, patternId, platform } });
  },

  recordSubscribeClick(userId: string, platform: EventPlatform) {
    return prisma.subscribeClick.create({ data: { userId, platform } });
  },

  recordSearchQuery(userId: string, query: string, resultsCount: number, platform: EventPlatform) {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
    return prisma.searchQuery.create({ data: { userId, query: normalized, resultsCount, platform } });
  },
};
