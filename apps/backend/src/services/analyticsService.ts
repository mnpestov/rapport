import { prisma } from "../prismaClient";

/**
 * Analytics persistence. Controllers handle HTTP (validation, status codes);
 * all DB writes live here so ingestion logic can be reused/tested in isolation.
 * userId always originates from the JWT — never from the request body.
 */
export const AnalyticsService = {
  recordPatternView(userId: string, patternId: string) {
    return prisma.patternView.create({ data: { userId, patternId } });
  },

  recordPatternLinkClick(userId: string, patternId: string) {
    return prisma.patternLinkClick.create({ data: { userId, patternId } });
  },

  recordSubscribeClick(userId: string) {
    return prisma.subscribeClick.create({ data: { userId } });
  },
};
