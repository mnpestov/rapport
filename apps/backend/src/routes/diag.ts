import { Router, Request, Response } from 'express';

const router = Router();

router.post('/log', (req: Request, res: Response) => {
  const { event, telegramId, initDataLength, isSubscriber, tgExists, tgVersion, platform, error, userAgent } = req.body ?? {};
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;
  console.log(
    `[FRONTEND] event=${event ?? '?'} telegramId=${telegramId ?? '?'} initDataLength=${initDataLength ?? '?'} isSubscriber=${isSubscriber ?? '?'} tgExists=${tgExists ?? '?'} tgVersion=${tgVersion ?? '?'} platform=${platform ?? '?'} error=${error ?? '-'} ua=${userAgent ?? '-'} ip=${ip}`,
  );
  res.status(200).json({ ok: true });
});

export default router;
