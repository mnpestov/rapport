import { Router, Request, Response } from 'express';
import { prisma } from '../prismaClient';

const router = Router();

router.post('/log', async (req: Request, res: Response) => {
  const { event, telegramId, initDataLength, isSubscriber, tgExists, tgVersion, platform, error, userAgent, restoredFromSession, navType, perfNavType, hashLength, pathname, referrer } = req.body ?? {};
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;
  console.log(
    `[FRONTEND] event=${event ?? '?'} telegramId=${telegramId ?? '?'} initDataLength=${initDataLength ?? '?'} isSubscriber=${isSubscriber ?? '?'} tgExists=${tgExists ?? '?'} tgVersion=${tgVersion ?? '?'} platform=${platform ?? '?'} restored=${restoredFromSession ?? '?'} navType=${navType ?? '?'} perfNav=${perfNavType ?? '?'} hashLen=${hashLength ?? '?'} path=${pathname ?? '?'} referrer=${referrer ?? '-'} error=${error ?? '-'} ua=${userAgent ?? '-'} ip=${ip}`,
  );

  if (event === 'AUTH_START' && telegramId) {
    const updateData: Record<string, string> = {};
    if (platform) updateData.platform = String(platform);
    if (tgVersion) updateData.tgVersion = String(tgVersion);
    if (userAgent) updateData.userAgent = String(userAgent);
    if (Object.keys(updateData).length > 0) {
      prisma.user.updateMany({
        where: { telegramId: BigInt(telegramId) },
        data: updateData,
      }).catch(() => { /* fire-and-forget */ });
    }
  }

  res.status(200).json({ ok: true });
});

export default router;
