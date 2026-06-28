import { GrammyError } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';

export async function handleFallback(ctx: CustomContext): Promise<void> {
  const telegramId = ctx.from?.id ?? null;

  logEvent({
    event: 'UNHANDLED_UPDATE',
    requestId: ctx.requestId,
    telegramId,
    username: ctx.from?.username ?? null,
    textLength: ctx.message?.text?.length ?? null,
  });

  try {
    await ctx.reply('Я не понимаю это сообщение. Воспользуйтесь кнопками.');
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 403) {
      logEvent({
        event: 'REPLY_BLOCKED',
        requestId: ctx.requestId,
        telegramId,
        reason: 'bot_blocked_by_user',
      });
      return;
    }
    throw err;
  }
}
