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

  const keyboard = new InlineKeyboard()
    .text('Запустить диагностику', 'diagnostic:start').row()
    .text('Стать автором', 'author_app:begin').row()
    .url('Открыть Раппорт', 'https://t.me/rapportapp_bot/rapport');
  await ctx.reply(
    'Привет! Это служба поддержки Раппорт. 🛠\n\n' +
    'Если вы не можете войти в приложение — запустите диагностику, и мы всё починим.\n' +
    'Хотите разместить свои описания в Раппорт — подайте заявку на авторский кабинет.',
    { reply_markup: keyboard },
  );

  logEvent({
    event: 'REPLY_SENT',
    requestId: ctx.requestId,
    telegramId,
    replyType: 'start_greeting',
  });
}
