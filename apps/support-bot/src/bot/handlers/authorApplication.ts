import { InlineKeyboard } from 'grammy';
import type { Filter } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';
import { BackendClient, AuthorApplicationError } from '../../services/backendClient';

type CallbackCtx = Filter<CustomContext, 'callback_query:data'>;

const backendClient = new BackendClient();

const MAX_RESOURCES = 10;
const MAX_RESOURCE_LENGTH = 500;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 120;
const REAPPLY_COOLDOWN_MS = 24 * 3600 * 1000;

const RESOURCES_KEYBOARD = new InlineKeyboard()
  .text('Готово ✓', 'author_app:submit').row()
  .text('Отмена', 'author_app:cancel');

const NEEDS_INFO_KEYBOARD = new InlineKeyboard()
  .text('Ответить', 'author_app:respond_start').row()
  .text('Отмена', 'author_app:cancel');

const RESPOND_KEYBOARD = new InlineKeyboard()
  .text('Отправить ✓', 'author_app:respond_submit').row()
  .text('Отмена', 'author_app:cancel');

function resetSession(ctx: CustomContext): void {
  ctx.session.authorAppStep = undefined;
  ctx.session.authorAppName = undefined;
  ctx.session.authorAppResources = [];
  ctx.session.authorAppResponseText = undefined;
}

function startDialog(ctx: CustomContext): Promise<unknown> {
  ctx.session.authorAppStep = 'name';
  ctx.session.authorAppName = undefined;
  ctx.session.authorAppResources = [];
  return ctx.reply('Как называется ваш авторский профиль?');
}

// /become_author — entry point. Checks the current application status first
// so a user who already applied doesn't restart the dialog from scratch
// (implementation_plan.md §6).
export async function handleBecomeAuthor(ctx: CustomContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  logEvent({
    event: 'COMMAND_RECEIVED',
    requestId: ctx.requestId,
    telegramId,
    username: ctx.from?.username ?? null,
    command: 'become_author',
  });

  let result;
  try {
    result = await backendClient.getApplicationStatus(telegramId);
  } catch (err) {
    logEvent({
      event: 'AUTHOR_APP_STATUS_ERROR',
      requestId: ctx.requestId,
      telegramId,
      error: (err as Error).message,
    });
    await ctx.reply('Не удалось проверить статус заявки. Попробуйте ещё раз позже.');
    return;
  }

  switch (result.status) {
    case 'PENDING':
      await ctx.reply('Заявка на рассмотрении. Мы сообщим о решении.');
      return;
    case 'NEEDS_INFO':
      await ctx.reply(
        `По вашей заявке на авторский кабинет требуется уточнение:\n\n` +
          `${result.adminComment ?? 'администратор запросил дополнительную информацию.'}\n\n` +
          `Нажмите «Ответить», чтобы дополнить заявку текстом или новыми ссылками — ` +
          `отвечать нужно здесь, в этом диалоге, а не отдельным сообщением в чат.`,
        { reply_markup: NEEDS_INFO_KEYBOARD },
      );
      return;
    case 'APPROVED':
      await ctx.reply('Доступ уже выдан — admin.rapport.su');
      return;
    case 'REJECTED': {
      const processedAt = result.processedAt ? new Date(result.processedAt).getTime() : null;
      if (processedAt && Date.now() - processedAt < REAPPLY_COOLDOWN_MS) {
        await ctx.reply('Заявка была отклонена. Повторно подать можно через 24 часа после отклонения.');
        return;
      }
      await startDialog(ctx);
      return;
    }
    case null:
    default:
      await startDialog(ctx);
      return;
  }
}

// Called from fallback.ts before its default handling, only while
// ctx.session.authorAppStep is set. Returns true if it consumed the
// message (fallback.ts must then return without further processing).
export async function handleAuthorApplicationStep(ctx: CustomContext): Promise<boolean> {
  const step = ctx.session.authorAppStep;
  if (!step) return false;

  const telegramId = ctx.from?.id;
  const text = ctx.message?.text?.trim();
  if (!telegramId || text === undefined) return false;

  if (step === 'name') {
    if (text.length < MIN_NAME_LENGTH || text.length > MAX_NAME_LENGTH) {
      await ctx.reply(`Название должно быть от ${MIN_NAME_LENGTH} до ${MAX_NAME_LENGTH} символов. Попробуйте ещё раз.`);
      return true;
    }
    ctx.session.authorAppName = text;
    ctx.session.authorAppStep = 'resources';
    await ctx.reply(
      'Укажите ссылки на ваши профили (eiwi, Etsy, VK, Boosty и т.д.). По одной ссылке в сообщении. Максимум 10.',
      { reply_markup: RESOURCES_KEYBOARD },
    );
    return true;
  }

  if (step === 'resources') {
    if (ctx.session.authorAppResources.length >= MAX_RESOURCES) {
      await ctx.reply('Максимум 10 ресурсов. Нажмите «Готово ✓», чтобы отправить заявку.', {
        reply_markup: RESOURCES_KEYBOARD,
      });
      return true;
    }
    if (text.length === 0 || text.length > MAX_RESOURCE_LENGTH) {
      await ctx.reply(`Ссылка должна быть не длиннее ${MAX_RESOURCE_LENGTH} символов. Попробуйте ещё раз.`, {
        reply_markup: RESOURCES_KEYBOARD,
      });
      return true;
    }
    ctx.session.authorAppResources.push(text);
    await ctx.reply(
      `Добавлено (${ctx.session.authorAppResources.length}/${MAX_RESOURCES}). Пришлите ещё ссылку или нажмите «Готово ✓».`,
      { reply_markup: RESOURCES_KEYBOARD },
    );
    return true;
  }

  // step === 'respond' — every message (text and/or links) is appended as
  // one line into a single free-text reply; the backend doesn't try to
  // parse structure out of it, it's shown to the admin as-is.
  if (text.length > MAX_RESOURCE_LENGTH) {
    await ctx.reply(`Сообщение должно быть не длиннее ${MAX_RESOURCE_LENGTH} символов.`, {
      reply_markup: RESPOND_KEYBOARD,
    });
    return true;
  }
  ctx.session.authorAppResponseText = ctx.session.authorAppResponseText
    ? `${ctx.session.authorAppResponseText}\n${text}`
    : text;
  await ctx.reply('Добавлено. Можете написать ещё или нажать «Отправить ✓».', {
    reply_markup: RESPOND_KEYBOARD,
  });
  return true;
}

export async function handleAuthorAppSubmit(ctx: CallbackCtx): Promise<void> {
  await ctx.answerCallbackQuery();

  const telegramId = ctx.from.id;
  const authorName = ctx.session.authorAppName;
  const resources = ctx.session.authorAppResources;

  if (ctx.session.authorAppStep !== 'resources' || !authorName) {
    // Stale callback (e.g. user restarted /become_author in another
    // message) — nothing to submit.
    await ctx.reply('Сессия заявки устарела. Начните заново: /become_author');
    return;
  }

  if (resources.length === 0) {
    await ctx.reply('Укажите хотя бы один ресурс.', { reply_markup: RESOURCES_KEYBOARD });
    return;
  }

  try {
    await backendClient.submitAuthorApplication({ telegramId, authorName, resources });
  } catch (err) {
    if (err instanceof AuthorApplicationError) {
      logEvent({
        event: 'AUTHOR_APP_SUBMIT_REJECTED',
        requestId: ctx.requestId,
        telegramId,
        status: err.status,
        error: err.message,
      });
      await ctx.reply(err.message);
    } else {
      logEvent({
        event: 'AUTHOR_APP_SUBMIT_ERROR',
        requestId: ctx.requestId,
        telegramId,
        error: (err as Error).message,
      });
      await ctx.reply('Не удалось отправить заявку. Попробуйте ещё раз позже.');
    }
    return;
  }

  resetSession(ctx);
  await ctx.reply('Заявка принята ✅. Мы сообщим о решении.');
}

export async function handleAuthorAppCancel(ctx: CallbackCtx): Promise<void> {
  await ctx.answerCallbackQuery();
  resetSession(ctx);
  await ctx.reply('Отменено.');
}

// "Ответить" on a NEEDS_INFO application — starts the respond sub-flow
// instead of restarting the whole name+resources dialog (the old
// "Подать повторно" button called startDialog here, which fed into
// submitAuthorApplication and silently created a second application while
// the original NEEDS_INFO one sat abandoned).
export async function handleAuthorAppRespondStart(ctx: CallbackCtx): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.authorAppStep = 'respond';
  ctx.session.authorAppResponseText = undefined;
  await ctx.reply(
    'Напишите пояснение текстом и/или пришлите новые ссылки — можно несколькими сообщениями. ' +
      'Когда закончите — нажмите «Отправить ✓».',
    { reply_markup: RESPOND_KEYBOARD },
  );
}

export async function handleAuthorAppRespondSubmit(ctx: CallbackCtx): Promise<void> {
  await ctx.answerCallbackQuery();

  const telegramId = ctx.from.id;
  const userResponse = ctx.session.authorAppResponseText;

  if (ctx.session.authorAppStep !== 'respond') {
    await ctx.reply('Сессия ответа устарела. Начните заново: /become_author');
    return;
  }

  if (!userResponse) {
    await ctx.reply('Напишите хотя бы одно сообщение перед отправкой.', {
      reply_markup: RESPOND_KEYBOARD,
    });
    return;
  }

  try {
    await backendClient.respondToApplication({ telegramId, userResponse });
  } catch (err) {
    if (err instanceof AuthorApplicationError) {
      logEvent({
        event: 'AUTHOR_APP_RESPOND_REJECTED',
        requestId: ctx.requestId,
        telegramId,
        status: err.status,
        error: err.message,
      });
      await ctx.reply(err.message);
    } else {
      logEvent({
        event: 'AUTHOR_APP_RESPOND_ERROR',
        requestId: ctx.requestId,
        telegramId,
        error: (err as Error).message,
      });
      await ctx.reply('Не удалось отправить ответ. Попробуйте ещё раз позже.');
    }
    return;
  }

  resetSession(ctx);
  await ctx.reply('Ответ отправлен ✅. Заявка снова на рассмотрении.');
}
