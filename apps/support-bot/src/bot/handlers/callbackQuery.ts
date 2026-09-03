import { InlineKeyboard } from 'grammy';
import type { Filter } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';
import { BackendClient } from '../../services/backendClient';
import { notifyAdmin } from '../admin';
import type { DiagnosticOutcome } from '@knitting/shared';

type CallbackCtx = Filter<CustomContext, 'callback_query:data'>;

const backendClient = new BackendClient();

const RETRY_KEYBOARD = new InlineKeyboard().text('Проверить ещё раз', 'diagnostic:start');
const RETRY_AFTER_ERROR_KEYBOARD = new InlineKeyboard().text('Проверить ещё раз', 'diagnostic:retry');
const WHITELISTED_KEYBOARD = new InlineKeyboard()
  .text('Всё равно не открывается', 'support:escalate').row()
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
  if (code === 'SUBSCRIBED' || code === 'SUBSCRIBED_WHITELISTED' || code === 'AUTO_FIXED') {
    return WHITELISTED_KEYBOARD;
  }
  if (code === 'GATEWAY_ERROR') return RETRY_AFTER_ERROR_KEYBOARD;
  return RETRY_KEYBOARD;
}

async function runDiagnosticFlow(ctx: CallbackCtx, isRetry: boolean): Promise<void> {
  const telegramId = ctx.from.id;
  const username = ctx.from.username ?? undefined;
  const firstName = ctx.from.first_name ?? undefined;
  const lastName = ctx.from.last_name ?? undefined;
  const languageCode = ctx.from.language_code ?? undefined;
  const isPremium = ctx.from.is_premium ?? false;

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
    languageCode: languageCode ?? null,
    isPremium,
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
      languageCode ? `Язык: ${languageCode}` : null,
      isPremium ? `Premium: да` : null,
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

const OPEN_RAPPORT_URL = 'https://t.me/rapportapp_bot/rapport';
const SITE_URL = 'https://rapport.su';

// Экран 1: пользователь подтверждённо подписан, но Mini App не открывается.
// Объясняем про прокси/VPN и предлагаем веб-версию. Диагностика уже
// подтвердила подписку (этот callback вызывается только для SUBSCRIBED* /
// AUTO_FIXED), так что отдельная проверка не нужна.
export async function handleEscalate(ctx: CallbackCtx): Promise<void> {
  logEvent({
    event: 'WEB_ALTERNATIVE_OFFERED',
    requestId: ctx.requestId,
    telegramId: ctx.from.id,
  });

  await ctx.answerCallbackQuery();

  const text =
    'Мы проверили — подписка на канал у вас активна, доступ есть.\n\n' +
    'Иногда мини-приложение не открывается из-за настроек Telegram: включённый ' +
    'прокси или VPN в самом Telegram могут блокировать запуск встроенных ' +
    'приложений. Это не зависит от нас.\n\n' +
    'На этот случай у нас есть веб-версия Раппорта — тот же каталог, работает ' +
    'в браузере телефона. Если добавить ярлык на экран «Домой», она открывается ' +
    'как обычное приложение, отдельным значком.\n\n' +
    'Хотите — я выдам вам логин и пароль для входа на сайте.';

  const keyboard = new InlineKeyboard()
    .text('Получить логин для сайта', 'web_access:begin').row()
    .text('Хочу остаться в Телеграм', 'support:proxy_not_it').row()
    .url('Открыть Раппорт', OPEN_RAPPORT_URL);

  await ctx.reply(text, { reply_markup: keyboard });
}

// Экран 2: пользователь хочет остаться в Telegram — даём инструкцию по
// очистке кэша (прежний текст handleEscalate).
export async function handleStayInTelegram(ctx: CallbackCtx): Promise<void> {
  logEvent({
    event: 'CACHE_CLEAR_INSTRUCTION_SENT',
    requestId: ctx.requestId,
    telegramId: ctx.from.id,
  });

  await ctx.answerCallbackQuery();

  const text =
    'Тогда часто помогает очистка кэша Telegram:\n\n' +
    '1. Настройки → Данные и память → Использование памяти\n' +
    '2. Снимите все галочки, оставьте только «Прочее», нажмите «Очистить».\n' +
    '3. Полностью закройте Telegram (смахните из недавних) и откройте Раппорт заново.';

  const keyboard = new InlineKeyboard()
    .text('Не помогло', 'support:cache_failed').row()
    .url('Открыть Раппорт', OPEN_RAPPORT_URL);

  await ctx.reply(text, { reply_markup: keyboard });
}

// Экран 3: кэш не помог — почти наверняка VPN/прокси. Даём варианты и
// снова предлагаем веб.
export async function handleCacheFailed(ctx: CallbackCtx): Promise<void> {
  logEvent({
    event: 'VPN_HINT_SENT',
    requestId: ctx.requestId,
    telegramId: ctx.from.id,
  });

  await ctx.answerCallbackQuery();

  const text =
    'Тогда, скорее всего, дело в VPN или прокси — они мешают Telegram запустить приложение.\n\n' +
    'Что можно попробовать:\n' +
    '• отключить VPN/прокси в настройках Telegram и открыть Раппорт заново;\n' +
    '• подключиться через другой VPN или другую сеть;\n' +
    `• зайти через веб-версию — там VPN не мешает: ${SITE_URL}`;

  const keyboard = new InlineKeyboard()
    .text('Получить логин для сайта', 'web_access:begin').row()
    .text('Нужна помощь специалиста', 'support:manual').row()
    .url('Открыть Раппорт', OPEN_RAPPORT_URL);

  await ctx.reply(text, { reply_markup: keyboard });
}

// Ручная эскалация: сбор скриншота + пометка на бэкенде (прежний
// handleCacheFailed).
export async function handleManualHelp(ctx: CallbackCtx): Promise<void> {
  const telegramId = ctx.from.id;
  const username = ctx.from.username ?? undefined;

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

  ctx.session.awaitingScreenshot = true;

  await ctx.reply(
    'Пожалуйста, пришлите скриншот экрана с ошибкой или кратко опишите проблему прямо в этот чат. Специалист рассмотрит обращение вручную.',
  );
}
