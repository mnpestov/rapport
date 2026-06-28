import { InlineKeyboard } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';

export async function handleStart(ctx: CustomContext): Promise<void> {
  const startParam = ctx.match ?? '';
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  logEvent({
    event: 'COMMAND_RECEIVED',
    requestId: ctx.requestId,
    telegramId,
    username: ctx.from?.username ?? null,
    command: 'start',
    hasStartParam: startParam.length > 0,
    startParam: startParam || null,
  });

  const keyboard = new InlineKeyboard().text('Запустить диагностику', 'diagnostic:start');
  await ctx.reply(
    'Привет! Это бот поддержки Rapport.\n\n' +
      'Если вы подписаны на канал, но не можете войти в приложение — нажмите кнопку ниже.',
    { reply_markup: keyboard },
  );

  logEvent({
    event: 'REPLY_SENT',
    requestId: ctx.requestId,
    telegramId,
    replyType: 'start_greeting',
  });
}
