import { InlineKeyboard } from 'grammy';
import type { Filter } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';
import { BackendClient } from '../../services/backendClient';
import type { DiagnosticOutcome } from '@knitting/shared';

type CallbackCtx = Filter<CustomContext, 'callback_query:data'>;

const backendClient = new BackendClient();

const RETRY_KEYBOARD = new InlineKeyboard().text('Проверить ещё раз', 'diagnostic:start');

const MESSAGES: Record<DiagnosticOutcome, string> = {
  SUBSCRIBED:
    'У вас есть доступ.\n\nПопробуйте открыть приложение ещё раз.',
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
  GATEWAY_ERROR:
    'Во время проверки произошла временная ошибка.\n\nПопробуйте ещё раз немного позже.',
};

export async function handleDiagnosticStart(ctx: CallbackCtx): Promise<void> {
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

  logEvent({
    event: 'DIAGNOSTIC_STARTED',
    requestId: ctx.requestId,
    telegramId,
  });

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
    await ctx.reply(
      'Не удалось выполнить проверку. Попробуйте ещё раз позже.',
      { reply_markup: RETRY_KEYBOARD },
    );
    return;
  }

  logEvent({
    event: 'DIAGNOSTIC_COMPLETED',
    requestId: ctx.requestId,
    telegramId,
    diagnosticCode: result.diagnosticCode,
    backendRequestId: result.meta.requestId,
  });

  const text = MESSAGES[result.diagnosticCode] ?? MESSAGES.GATEWAY_ERROR;
  await ctx.reply(text, { reply_markup: RETRY_KEYBOARD });
}
