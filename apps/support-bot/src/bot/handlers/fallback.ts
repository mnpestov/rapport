import { GrammyError } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';
import { BackendClient } from '../../services/backendClient';

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
  const telegramId = ctx.from?.id ?? null;
  const { messageType, fileId } = detectMessageType(ctx);
  const text = ctx.message?.text ?? null;

  logEvent({
    event: 'UNHANDLED_UPDATE',
    requestId: ctx.requestId,
    telegramId,
    username: ctx.from?.username ?? null,
    messageType,
    textLength: text?.length ?? null,
  });

  if (telegramId) {
    backendClient.saveMessage({
      telegramId,
      username: ctx.from?.username ?? null,
      firstName: ctx.from?.first_name ?? null,
      messageType,
      text,
      fileId: fileId ?? null,
    });
  }

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
