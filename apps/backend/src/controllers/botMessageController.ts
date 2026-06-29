import { Request, Response } from 'express';
import { prisma } from '../prismaClient';

export async function saveBotMessage(req: Request, res: Response): Promise<void> {
  const { telegramId, username, firstName, messageType, text, fileId } = req.body;

  if (!telegramId || !messageType) {
    res.status(400).json({ error: 'telegramId and messageType are required' });
    return;
  }

  await prisma.botInboundMessage.create({
    data: {
      telegramId: BigInt(telegramId),
      username: username ?? null,
      firstName: firstName ?? null,
      messageType,
      text: text ?? null,
      fileId: fileId ?? null,
    },
  });

  res.status(201).json({ ok: true });
}
