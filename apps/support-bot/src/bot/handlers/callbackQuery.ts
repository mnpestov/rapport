import { InlineKeyboard } from 'grammy';
import type { Filter } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';
import { BackendClient } from '../../services/backendClient';
import { config } from '../../config';
import type { DiagnosticOutcome } from '@knitting/shared';

type CallbackCtx = Filter<CustomContext, 'callback_query:data'>;

const backendClient = new BackendClient();

const RETRY_KEYBOARD = new InlineKeyboard().text('Проверить ещё раз', 'diagnostic:start');
const RETRY_AFTER_ERROR_KEYBOARD = new InlineKeyboard().text('Проверить ещё раз', 'diagnostic:retry');
const WHITELISTED_KEYBOARD = new InlineKeyboard()
  .text('Я всё равно не могу войти', 'support:escalate').row()
  .url('Открыть Раппорт', 'https://t.me/rapportapp_bot/rapport');

const MESSAGES: Record<DiagnosticOutcome, string> = {
  SUBSCRIBED: 'У вас есть доступ.\n\nПопробуйте открыть приложение ещё раз.',
  SUBSCRIBED_WHITELISTED:
    'Мы проверили вашу подписку и добавили вас в список доступа.\n\nПопробуйте открыть приложение снова. Если не получится — нажмите кнопку ниже.',
  AUTO_FIXED:
    'Проблема была обнаружена и исправлена автоматически.\n\nПодождите около 30 секунд и снова откройте приложение.',
  NOT_SUBSCRIBED:
    'Похоже, вы не подписаны на канал.\n\nПодпишитесь и после этого снова нажмите кнопку проверки.',
  KICKED:
    'Похоже, ранее вы были удалены из канала.\n\nПодпишитесь повторно и снова выполните проверку.',
  PARTICIPANT_ID_INVALID:
    'Telegram вернул ошибку проверки.\n\nМы уже получили информацию.\nЕсли проблема не исчезнет, обратитесь в поддержку.',
  MANUAL_REVIEW_REQUIRED:
    'Автоматически решить проблему не удалось.\n\nИнформация уже собрана.\nМы проверим её вручную.',
  GATEWAY_ERROR: 'Во время проверки произошла временная ошибка.\n\nПопробуйте ещё раз.',
};

function keyboardFor(code: DiagnosticOutcome): InlineKeyboard {
  if (code === 'SUBSCRIBED_WHITELISTED') return WHITELISTED_KEYBOARD;
  if (code === 'GATEWAY_ERROR') return RETRY_AFTER_ERROR_KEYBOARD;
  return RETRY_KEYBOARD;
}

async function notifyAdmin(ctx: CallbackCtx, message: string): Promise<void> {
  const adminId = config.adminTelegramId;
  if (!adminId) return;
  try {
    await ctx.api.sendMessage(adminId, message, { parse_mode: 'HTML' });
  } catch (err) {
    logEvent({
      event: 'ADMIN_NOTIFY_ERROR',
      requestId: ctx.requestId,
      telegramId: ctx.from.id,
      error: (err as Error).message,
    });
  }
}

async function runDiagnosticFlow(ctx: CallbackCtx, isRetry: boolean): Promise<void> {
  const telegramId = ctx.from.id;
  const username = ctx.from.username ?? undefined;
  const firstName = ctx.from.first_name ?? undefined;
  const lastName = ctx.from.last_name ?? undefined;

  logEvent({
    event: 'CALLBACK_QUERY_RECEIVED',
    requestId: ctx.requestId,
    telegramId,
    username: username ?? null,
    data: ctx.callbackQuery.data,
  });

  await ctx.answerCallbackQuery();
  logEvent({ event: 'DIAGNOSTIC_STARTED', requestId: ctx.requestId, telegramId, isRetry });

  let result;
  try {
    result = await backendClient.diagnose(telegramId, { username, firstName, lastName });
  } catch (err) {
    logEvent({
      event: 'DIAGNOSTIC_ERROR',
      requestId: ctx.requestId,
      telegramId,
      error: (err as Error).message,
    });
    await ctx.reply('Не удалось выполнить проверку. Попробуйте ещё раз позже.', {
      reply_markup: RETRY_KEYBOARD,
    });
    return;
  }

  logEvent({
    event: 'DIAGNOSTIC_COMPLETED',
    requestId: ctx.requestId,
    telegramId,
    diagnosticCode: result.diagnosticCode,
    backendRequestId: result.meta.requestId,
    isRetry,
  });

  if (result.diagnosticCode === 'GATEWAY_ERROR' && isRetry) {
    const nameParts = [firstName, lastName].filter(Boolean).join(' ');
    const adminMsg = [
      '<b>⚠️ Ошибка диагностики (повторная)</b>',
      '',
      `ID: <code>${telegramId}</code>`,
      username ? `Username: @${username}` : null,
      nameParts ? `Имя: ${nameParts}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await notifyAdmin(ctx, adminMsg);
    logEvent({ event: 'ADMIN_NOTIFIED_GATEWAY_ERROR', requestId: ctx.requestId, telegramId });

    await ctx.reply(
      'Во время диагностики возникли ошибки.\n\nПожалуйста, попробуйте позднее или обратитесь напрямую.',
    );
    return;
  }

  const text = MESSAGES[result.diagnosticCode] ?? MESSAGES.GATEWAY_ERROR;
  await ctx.reply(text, { reply_markup: keyboardFor(result.diagnosticCode) });
}

export async function handleDiagnosticStart(ctx: CallbackCtx): Promise<void> {
  return runDiagnosticFlow(ctx, false);
}

export async function handleDiagnosticRetry(ctx: CallbackCtx): Promise<void> {
  return runDiagnosticFlow(ctx, true);
}

export async function handleEscalate(ctx: CallbackCtx): Promise<void> {
  const telegramId = ctx.from.id;
  const username = ctx.from.username ?? undefined;
  const firstName = ctx.from.first_name ?? undefined;
  const lastName = ctx.from.last_name ?? undefined;

  logEvent({
    event: 'ESCALATION_REQUESTED',
    requestId: ctx.requestId,
    telegramId,
    username: username ?? null,
  });

  await ctx.answerCallbackQuery();

  try {
    await backendClient.escalate(telegramId);
  } catch (err) {
    logEvent({
      event: 'ESCALATE_BACKEND_ERROR',
      requestId: ctx.requestId,
      telegramId,
      error: (err as Error).message,
    });
  }

  const nameParts = [firstName, lastName].filter(Boolean).join(' ');
  const adminMsg = [
    '<b>⚠️ Пользователь не может войти</b>',
    '',
    `ID: <code>${telegramId}</code>`,
    username ? `Username: @${username}` : null,
    nameParts ? `Имя: ${nameParts}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  await notifyAdmin(ctx, adminMsg);
  logEvent({ event: 'ESCALATION_TRIGGERED', requestId: ctx.requestId, telegramId });

  await ctx.reply(
    'Мы получили ваше обращение и проверим ситуацию вручную.\n\nЕсли потребуется дополнительная информация, мы свяжемся с вами.',
  );
}
