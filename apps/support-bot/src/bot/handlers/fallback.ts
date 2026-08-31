import { InlineKeyboard } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';
import { BackendClient } from '../../services/backendClient';
import { notifyAdmin } from '../admin';
import { handleAuthorApplicationStep } from './authorApplication';
import { handleWebAccessStep } from './webAccess';

const backendClient = new BackendClient();

function detectMessageType(ctx: CustomContext): { messageType: string; fileId?: string } {
  const msg = ctx.message;
  if (!msg) return { messageType: 'other' };
  if (msg.text) return { messageType: 'text' };
  if (msg.sticker) return { messageType: 'sticker', fileId: msg.sticker.file_id };
  if (msg.photo) return { messageType: 'photo', fileId: msg.photo.at(-1)?.file_id };
  if (msg.voice) return { messageType: 'voice', fileId: msg.voice.file_id };
  if (msg.video) return { messageType: 'video', fileId: msg.video.file_id };
  if (msg.video_note) return { messageType: 'video_note', fileId: msg.video_note.file_id };
  if (msg.document) return { messageType: 'document', fileId: msg.document.file_id };
  if (msg.audio) return { messageType: 'audio', fileId: msg.audio.file_id };
  return { messageType: 'other' };
}

export async function handleFallback(ctx: CustomContext): Promise<void> {
  // Only handle private messages — ignore channel discussion groups and group chats
  if (ctx.chat?.type !== 'private') return;

  // Author-application dialog (implementation_plan.md §6) takes priority
  // over the default "saved for support" handling below, for as long as
  // ctx.session.authorAppStep is set.
  if (ctx.session.authorAppStep) {
    const consumed = await handleAuthorApplicationStep(ctx);
    if (consumed) return;
  }

  // Диалог логина для входа на сайт — та же логика приоритета, что и у
  // заявки выше: пока шаг активен, текст это ответ на вопрос бота, а не
  // обращение в поддержку.
  if (ctx.session.webAccessStep) {
    const consumed = await handleWebAccessStep(ctx);
    if (consumed) return;
  }

  const telegramId = ctx.from?.id ?? null;
  const { messageType, fileId } = detectMessageType(ctx);
  const text = ctx.message?.text ?? ctx.message?.caption ?? null;

  // Service messages (new_chat_member, allow_write_to_pm, etc.) have no content — ignore
  if (messageType === 'other') return;

  logEvent({
    event: 'UNHANDLED_UPDATE',
    requestId: ctx.requestId,
    telegramId,
    username: ctx.from?.username ?? null,
    messageType,
    textLength: text?.length ?? null,
  });

  if (telegramId) {
    if (ctx.session.awaitingScreenshot) {
      ctx.session.awaitingScreenshot = false;
      
      const username = ctx.from?.username;
      const nameParts = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ');
      
      const adminMsg = [
        '<b>⚠️ Пользователь прислал данные (скриншот/текст)</b>',
        '',
        `ID: <code>${telegramId}</code>`,
        username ? `Username: @${username}` : null,
        nameParts ? `Имя: ${nameParts}` : null,
        `Тип сообщения: ${messageType}`
      ].filter(Boolean).join('\n');
      
      await notifyAdmin(ctx, adminMsg);
      await ctx.reply('Спасибо! Мы получили информацию, администраторы уже уведомлены и скоро помогут вам.');
    } else {
      const keyboard = new InlineKeyboard().text('Запустить диагностику', 'diagnostic:start');
      await ctx.reply(
        'Я сохранил ваше сообщение для поддержки. Чтобы попытаться решить проблему автоматически прямо сейчас — нажмите кнопку ниже.',
        { reply_markup: keyboard }
      );
    }

    backendClient.saveMessage({
      telegramId,
      username: ctx.from?.username ?? null,
      firstName: ctx.from?.first_name ?? null,
      messageType,
      text,
      fileId: fileId ?? null,
    });
  }
}
