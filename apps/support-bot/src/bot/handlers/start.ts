import { InlineKeyboard } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';

// Приветствие + меню. Используется и командой /start, и fallback.ts, когда
// вернувшийся пользователь просто пишет в чат (кнопки «Начать» у него уже
// нет, а полное меню всё равно полезно показать).
export async function sendGreeting(ctx: CustomContext): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text('Запустить диагностику', 'diagnostic:start').row()
    .text('Стать автором', 'author_app:begin').row()
    .text('Войти на сайте', 'web_access:begin').row()
    .url('Открыть Раппорт', 'https://t.me/rapportapp_bot/rapport');
  await ctx.reply(
    'Привет!\nЭто служба поддержки Раппорта 🛠\n\n' +
    'Если вы не можете войти в приложение — запустите диагностику, и мы всё починим.\n\n' +
    'Хотите разместить свои описания в Раппорте — подайте заявку на авторский кабинет.\n\n' +
    'Хотите использовать Раппорт без ВПН и Телеграмм — получите логин для входа на сайте.',
    { reply_markup: keyboard },
  );
}

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

  await sendGreeting(ctx);

  logEvent({
    event: 'REPLY_SENT',
    requestId: ctx.requestId,
    telegramId,
    replyType: 'start_greeting',
  });
}
