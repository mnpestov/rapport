import { Router, Request, Response } from 'express';
import { prisma } from '../prismaClient';

const router = Router();

// Temporary in-memory cache: telegramId → device info from AUTH_START.
// AUTH_START fires before the User record is created (first login race condition),
// so we defer the DB write until AUTH_RESULT when the record is guaranteed to exist.
//
// Bounded — this is a public, unauthenticated endpoint, and telegramId comes
// straight from the request body. Without a cap, a client that keeps sending
// AUTH_START with distinct telegramId values and never a matching AUTH_RESULT
// grows this map without limit. Entries older than DEVICE_CACHE_TTL_MS are
// dropped lazily (checked on insert), and the map is hard-capped at
// DEVICE_CACHE_MAX_SIZE by evicting the oldest entry — good enough for a
// best-effort device-info cache that only bridges one short request gap.
const DEVICE_CACHE_TTL_MS = 5 * 60 * 1000;
const DEVICE_CACHE_MAX_SIZE = 5000;
const deviceCache = new Map<string, { platform?: string; tgVersion?: string; userAgent?: string; expiresAt: number }>();

function pruneDeviceCache(): void {
  const now = Date.now();
  for (const [key, value] of deviceCache) {
    if (value.expiresAt <= now) deviceCache.delete(key);
  }
  while (deviceCache.size >= DEVICE_CACHE_MAX_SIZE) {
    const oldestKey = deviceCache.keys().next().value;
    if (oldestKey === undefined) break;
    deviceCache.delete(oldestKey);
  }
}

// telegramId is only ever a Telegram user id — always a positive integer,
// never zero-padded or signed. Rejecting anything else here is what keeps
// BigInt(tid) below from throwing on garbage input.
const TELEGRAM_ID_PATTERN = /^\d+$/;

router.post('/log', async (req: Request, res: Response) => {
  try {
    const { event, telegramId, initDataLength, isSubscriber, tgExists, tgVersion, platform, error, userAgent, restoredFromSession, navType, perfNavType, hashLength, pathname, referrer } = req.body ?? {};
    const ip = req.ip ?? req.socket?.remoteAddress ?? null;
    // Escape newlines in free-form fields before logging — pathname/referrer/
    // error/userAgent come straight from the client and could otherwise be
    // used to inject fake log lines.
    const esc = (v: unknown) => v === undefined || v === null ? null : String(v).replace(/[\r\n]/g, ' ');
    console.log(
      `[FRONTEND] event=${esc(event) ?? '?'} telegramId=${esc(telegramId) ?? '?'} initDataLength=${esc(initDataLength) ?? '?'} isSubscriber=${esc(isSubscriber) ?? '?'} tgExists=${esc(tgExists) ?? '?'} tgVersion=${esc(tgVersion) ?? '?'} platform=${esc(platform) ?? '?'} restored=${esc(restoredFromSession) ?? '?'} navType=${esc(navType) ?? '?'} perfNav=${esc(perfNavType) ?? '?'} hashLen=${esc(hashLength) ?? '?'} path=${esc(pathname) ?? '?'} referrer=${esc(referrer) ?? '-'} error=${esc(error) ?? '-'} ua=${esc(userAgent) ?? '-'} ip=${ip}`,
    );

    const tidRaw = telegramId !== undefined && telegramId !== null ? String(telegramId) : null;
    const tid = tidRaw && TELEGRAM_ID_PATTERN.test(tidRaw) ? tidRaw : null;

    if (event === 'AUTH_START' && tid) {
      // Cache device info — User record may not exist yet for first-time logins.
      pruneDeviceCache();
      deviceCache.set(tid, {
        platform: platform ? String(platform) : undefined,
        tgVersion: tgVersion ? String(tgVersion) : undefined,
        userAgent: userAgent ? String(userAgent) : undefined,
        expiresAt: Date.now() + DEVICE_CACHE_TTL_MS,
      });
    }

    if (event === 'AUTH_RESULT' && tid) {
      // User record is now guaranteed to exist. Flush cached device info to DB.
      const cached = deviceCache.get(tid);
      deviceCache.delete(tid);

      const updateData: Record<string, string> = {};
      if (cached?.platform) updateData.platform = cached.platform;
      if (cached?.tgVersion) updateData.tgVersion = cached.tgVersion;
      const ua = userAgent ? String(userAgent) : cached?.userAgent;
      if (ua) updateData.userAgent = ua;

      if (Object.keys(updateData).length > 0) {
        prisma.user.updateMany({
          where: { telegramId: BigInt(tid) },
          data: updateData,
        }).catch(() => { /* fire-and-forget */ });
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[diag/log] Failed to process:', err);
    res.status(200).json({ ok: true });
  }
});

export default router;
