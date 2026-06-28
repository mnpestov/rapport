import crypto from 'crypto';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';
import type { NextFunction } from 'grammy';

export const updateLogger = async (ctx: CustomContext, next: NextFunction): Promise<void> => {
  ctx.requestId = crypto.randomUUID();
  const updateType = Object.keys(ctx.update).find((k) => k !== 'update_id') ?? 'unknown';
  logEvent({
    event: 'UPDATE_RECEIVED',
    requestId: ctx.requestId,
    updateId: ctx.update.update_id,
    updateType,
    telegramId: ctx.from?.id ?? null,
    chatId: ctx.chat?.id ?? null,
    username: ctx.from?.username ?? null,
  });
  await next();
};
