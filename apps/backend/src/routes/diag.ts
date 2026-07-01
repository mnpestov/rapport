import { Router, Request, Response } from 'express';

const router = Router();

router.post('/log', (req: Request, res: Response) => {
  const { event, telegramId, initDataLength, isSubscriber, tgExists, tgVersion, platform, error, userAgent, restoredFromSession, navType, perfNavType, hashLength, pathname, referrer } = req.body ?? {};
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;
  console.log(
    `[FRONTEND] event=${event ?? '?'} telegramId=${telegramId ?? '?'} initDataLength=${initDataLength ?? '?'} isSubscriber=${isSubscriber ?? '?'} tgExists=${tgExists ?? '?'} tgVersion=${tgVersion ?? '?'} platform=${platform ?? '?'} restored=${restoredFromSession ?? '?'} navType=${navType ?? '?'} perfNav=${perfNavType ?? '?'} hashLen=${hashLength ?? '?'} path=${pathname ?? '?'} referrer=${referrer ?? '-'} error=${error ?? '-'} ua=${userAgent ?? '-'} ip=${ip}`,
  );
  res.status(200).json({ ok: true });
});

export default router;
