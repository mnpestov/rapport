import cron from "node-cron";
import { prisma } from "../prismaClient";

const NEW_BADGE_DAYS = 21;

// Clears the "Новинка" badge 21 days after a pattern's first publication.
// publishedAt (not createdAt) is the anchor — see the field comment in
// schema.prisma for why: sync-imported patterns sit invisible in an admin
// review queue before publication, so createdAt can predate the moment
// users actually see them by however long that review takes.
export async function expireNewPatterns(): Promise<void> {
  const cutoff = new Date(Date.now() - NEW_BADGE_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.pattern.updateMany({
    where: { isNew: true, publishedAt: { not: null, lt: cutoff } },
    data: { isNew: false },
  });
  if (count > 0) {
    console.log(`[expireNewPatterns] cleared "Новинка" on ${count} pattern(s) published before ${cutoff.toISOString()}`);
  }
}

// Single rapport-api instance (no pm2 cluster mode) — safe to schedule
// in-process without a distributed lock.
export function startExpireNewPatternsJob(): void {
  expireNewPatterns().catch((err) => console.error("[expireNewPatterns] initial run failed:", err));

  cron.schedule("0 3 * * *", () => {
    expireNewPatterns().catch((err) => console.error("[expireNewPatterns] scheduled run failed:", err));
  });
}
