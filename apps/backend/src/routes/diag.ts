import { Router, Request, Response } from 'express';
import { prisma } from '../prismaClient';

const router = Router();

// Temporary in-memory cache: telegramId → device info from AUTH_START.
// AUTH_START fires before the User record is created (first login race condition),
// so we defer the DB write until AUTH_RESULT when the record is guaranteed to exist.
const deviceCache = new Map<string, { platform?: string; tgVersion?: string; userAgent?: string }>();

router.post('/log', async (req: Request, res: Response) => {
  const { event, telegramId, initDataLength, isSubscriber, tgExists, tgVersion, platform, error, userAgent, restoredFromSession, navType, perfNavType, hashLength, pathname, referrer } = req.body ?? {};
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;
  console.log(
    `[FRONTEND] event=${event ?? '?'} telegramId=${telegramId ?? '?'} initDataLength=${initDataLength ?? '?'} isSubscriber=${isSubscriber ?? '?'} tgExists=${tgExists ?? '?'} tgVersion=${tgVersion ?? '?'} platform=${platform ?? '?'} restored=${restoredFromSession ?? '?'} navType=${navType ?? '?'} perfNav=${perfNavType ?? '?'} hashLen=${hashLength ?? '?'} path=${pathname ?? '?'} referrer=${referrer ?? '-'} error=${error ?? '-'} ua=${userAgent ?? '-'} ip=${ip}`,
  );

  const tid = telegramId ? String(telegramId) : null;

  if (event === 'AUTH_START' && tid) {
    // Cache device info — User record may not exist yet for first-time logins.
    deviceCache.set(tid, {
      platform: platform ? String(platform) : undefined,
      tgVersion: tgVersion ? String(tgVersion) : undefined,
      userAgent: userAgent ? String(userAgent) : undefined,
    });
  }

  if (event === 'AUTH_RESULT' && tid) {
    // User record is now guaranteed to exist. Flush cached device info to DB.
    const cached = deviceCache.get(tid) ?? {};
    deviceCache.delete(tid);

    const updateData: Record<string, string> = {};
    if (cached.platform) updateData.platform = cached.platform;
    if (cached.tgVersion) updateData.tgVersion = cached.tgVersion;
    const ua = userAgent ? String(userAgent) : cached.userAgent;
    if (ua) updateData.userAgent = ua;

    if (Object.keys(updateData).length > 0) {
      prisma.user.updateMany({
        where: { telegramId: BigInt(tid) },
        data: updateData,
      }).catch(() => { /* fire-and-forget */ });
    }
  }

  res.status(200).json({ ok: true });
});

export default router;
