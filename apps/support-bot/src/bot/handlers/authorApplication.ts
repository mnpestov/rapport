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

// Совпадает с валидацией на бэкенде (authorCredentialHelpers). Бот — UX-слой:
// проверяем формат тут ради быстрой понятной ошибки, решает всё равно сервер.
const LOGIN_MIN = 3;
const LOGIN_MAX = 30;
const LOGIN_RE = /^[a-zA-Z0-9._-]+$/;

// Шаг ресурсов. «Далее ✓» появляется только когда добавлена хотя бы одна
// ссылка — раньше кнопка была всегда и по ней сразу ругалось «нужен ресурс».
const RESOURCES_KEYBOARD_EMPTY = new InlineKeyboard().text('Отмена', 'author_app:cancel');
const RESOURCES_KEYBOARD = new InlineKeyboard()
  .text('Далее ✓', 'author_app:resources_done').row()
  .text('Отмена', 'author_app:cancel');

// Клавиатура шага ресурсов по числу уже добавленных ссылок.
function resourcesKeyboard(count: number): InlineKeyboard {
  return count > 0 ? RESOURCES_KEYBOARD : RESOURCES_KEYBOARD_EMPTY;
}

// Сводка перед отправкой.
const CONFIRM_KEYBOARD = new InlineKeyboard()
  .text('Отправить ✓', 'author_app:submit').row()
  .text('Отмена', 'author_app:cancel');

// На шаге выбора логина — только отмена (логин присылается сообщением).
const LOGIN_KEYBOARD = new InlineKeyboard().text('Отмена', 'author_app:cancel');

// Backend error strings are a stable API contract, not user-facing copy —
// deliberately in English (see authorApplicationController.ts). Map the
// ones a user can actually hit; anything unrecognized falls back to a
// generic Russian message rather than showing raw English.
const KNOWN_ERROR_TRANSLATIONS: Record<string, string> = {
  "No application awaiting your response": "Заявка уже не ждёт ответа — возможно, она уже была обработана. Проверьте статус: /become_author",
  "You already have a pending application": "У вас уже есть заявка на рассмотрении.",
  "You already have author cabinet access": "У вас уже есть доступ к кабинету автора.",
  "Please wait 24h before reapplying": "Повторно подать можно через 24 часа после отклонения.",
  "login_taken": "Этот логин уже занят. Придумайте другой.",
  "no_draft": "Сессия заявки устарела. Начните заново: /become_author",
  "login_mismatch": "Что-то пошло не так с логином. Начните заново: /become_author",
  "credential_exists": "У вас уже есть логин для входа.",
};

function translateError(message: string): string {
  return KNOWN_ERROR_TRANSLATIONS[message] ?? 'Не удалось выполнить действие. Попробуйте ещё раз позже.';
}

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
  ctx.session.authorAppLogin = undefined;
  ctx.session.authorAppLoginPreexisting = undefined;
}

async function startDialog(ctx: CustomContext, existingLogin?: string | null): Promise<void> {
  ctx.session.authorAppStep = 'name';
  ctx.session.authorAppName = undefined;
  ctx.session.authorAppResources = [];
  // Логин у пользователя уже есть (завёл через «вход на сайт») — шаг выбора
  // логина в диалоге молча пропустим, используем этот.
  if (existingLogin) {
    ctx.session.authorAppLogin = existingLogin;
    ctx.session.authorAppLoginPreexisting = true;
  } else {
    ctx.session.authorAppLogin = undefined;
    ctx.session.authorAppLoginPreexisting = undefined;
  }
  await ctx.reply('Как называется ваш авторский профиль?');
}

// Просит придумать логин. Вызывается после шага ресурсов, если у
// пользователя ещё нет учётной записи.
function askLogin(ctx: CustomContext): Promise<unknown> {
  ctx.session.authorAppStep = 'login';
  return ctx.reply(
    [
      'Придумайте логин для входа в кабинет автора.',
      `Латинские буквы, цифры, точка, дефис или подчёркивание, от ${LOGIN_MIN} до ${LOGIN_MAX} символов.`,
      '',
      'Пароль сгенерируется автоматически — его нужно будет сменить при первом входе.',
    ].join('\n'),
    { reply_markup: LOGIN_KEYBOARD },
  );
}

// Показывает сводку заявки и ждёт подтверждения.
function showSummary(ctx: CustomContext): Promise<unknown> {
  ctx.session.authorAppStep = 'confirm';
  const name = ctx.session.authorAppName ?? '—';
  const login = ctx.session.authorAppLogin ?? '—';
  const resources = ctx.session.authorAppResources;
  const resourceLines = resources.map((r) => `• ${r}`).join('\n');
  const loginNote = ctx.session.authorAppLoginPreexisting ? ' (уже создан)' : '';

  return ctx.reply(
    [
      'Проверьте заявку:',
      '',
      `Профиль: ${name}`,
      `Логин: ${login}${loginNote}`,
      'Ресурсы:',
      resourceLines,
    ].join('\n'),
    { reply_markup: CONFIRM_KEYBOARD },
  );
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
    case 'DRAFT':
      // Незавершённый черновик прошлого захода — молча выбрасываем его
      // (логин освободится) и начинаем диалог заново.
      await backendClient.discardApplicationDraft(telegramId);
      await startDialog(ctx, result.existingLogin);
      return;
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
      await startDialog(ctx, result.existingLogin);
      return;
    }
    case null:
    default:
      await startDialog(ctx, result.existingLogin);
      return;
  }
}

// "Стать автором" button in /start (handlers/start.ts) — same entry point
// as the /become_author command, just reached via a button tap instead of
// typing the command. CallbackCtx is a CustomContext, so handleBecomeAuthor
// works unchanged; this wrapper only adds the answerCallbackQuery() a
// callback_query update requires (a command update doesn't have one).
export async function handleAuthorAppBegin(ctx: CallbackCtx): Promise<void> {
  await ctx.answerCallbackQuery();
  await handleBecomeAuthor(ctx);
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
      { reply_markup: resourcesKeyboard(ctx.session.authorAppResources.length) },
    );
    return true;
  }

  if (step === 'resources') {
    if (ctx.session.authorAppResources.length >= MAX_RESOURCES) {
      await ctx.reply('Максимум 10 ресурсов. Нажмите «Далее ✓».', {
        reply_markup: resourcesKeyboard(ctx.session.authorAppResources.length),
      });
      return true;
    }
    if (text.length === 0 || text.length > MAX_RESOURCE_LENGTH) {
      await ctx.reply(`Ссылка должна быть не длиннее ${MAX_RESOURCE_LENGTH} символов. Попробуйте ещё раз.`, {
        reply_markup: resourcesKeyboard(ctx.session.authorAppResources.length),
      });
      return true;
    }
    ctx.session.authorAppResources.push(text);
    await ctx.reply(
      `Добавлено (${ctx.session.authorAppResources.length}/${MAX_RESOURCES}). Пришлите ещё ссылку или нажмите «Далее ✓».`,
      { reply_markup: resourcesKeyboard(ctx.session.authorAppResources.length) },
    );
    return true;
  }

  if (step === 'login') {
    if (text.length < LOGIN_MIN || text.length > LOGIN_MAX) {
      await ctx.reply(
        `Логин должен быть от ${LOGIN_MIN} до ${LOGIN_MAX} символов. Попробуйте ещё раз.`,
        { reply_markup: LOGIN_KEYBOARD },
      );
      return true;
    }
    if (!LOGIN_RE.test(text)) {
      await ctx.reply(
        'Только латинские буквы, цифры, точка, дефис и подчёркивание — без пробелов. Попробуйте ещё раз.',
        { reply_markup: LOGIN_KEYBOARD },
      );
      return true;
    }

    const authorName = ctx.session.authorAppName;
    const resources = ctx.session.authorAppResources;
    if (!authorName || resources.length === 0) {
      await ctx.reply('Сессия заявки устарела. Начните заново: /become_author');
      resetSession(ctx);
      return true;
    }

    try {
      const { login } = await backendClient.reserveApplicationLogin({
        telegramId,
        login: text,
        authorName,
        resources,
      });
      ctx.session.authorAppLogin = login;
      ctx.session.authorAppLoginPreexisting = false;
      await showSummary(ctx);
    } catch (err) {
      if (err instanceof AuthorApplicationError) {
        if (err.message === 'credential_exists') {
          // Учётка появилась параллельно (второе устройство) — берём её.
          ctx.session.authorAppLogin = err.login ?? text;
          ctx.session.authorAppLoginPreexisting = true;
          await showSummary(ctx);
          return true;
        }
        await ctx.reply(translateError(err.message), { reply_markup: LOGIN_KEYBOARD });
        return true;
      }
      console.error('[authorApp] reserveApplicationLogin failed:', err);
      await ctx.reply('Не удалось проверить логин. Попробуйте позже.', {
        reply_markup: LOGIN_KEYBOARD,
      });
    }
    return true;
  }

  // step === 'confirm' — ждём нажатия кнопки, произвольный текст игнорируем
  // (мягко напоминаем про кнопки).
  if (step === 'confirm') {
    await ctx.reply('Нажмите «Отправить ✓» или «Отмена».', {
      reply_markup: CONFIRM_KEYBOARD,
    });
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

// «Далее ✓» на шаге ресурсов — не отправляет заявку, а ведёт к выбору
// логина (или к сводке, если логин у пользователя уже есть).
export async function handleAuthorAppResourcesDone(ctx: CallbackCtx): Promise<void> {
  await ctx.answerCallbackQuery();

  const telegramId = ctx.from.id;
  const authorName = ctx.session.authorAppName;
  const resources = ctx.session.authorAppResources;

  if (ctx.session.authorAppStep !== 'resources' || !authorName) {
    await ctx.reply('Сессия заявки устарела. Начните заново: /become_author');
    return;
  }
  if (resources.length === 0) {
    await ctx.reply('Укажите хотя бы один ресурс.', {
      reply_markup: resourcesKeyboard(0),
    });
    return;
  }

  // Логин у пользователя уже есть — либо мы узнали это на входе в диалог
  // (лежит в сессии), либо перепроверяем сейчас. Шаг ручного ввода тогда
  // пропускаем: закрепляем существующий логин за черновиком и — в сводку.
  let existingLogin: string | null = ctx.session.authorAppLoginPreexisting
    ? ctx.session.authorAppLogin ?? null
    : null;

  if (!existingLogin) {
    try {
      const status = await backendClient.getApplicationStatus(telegramId);
      existingLogin = status.existingLogin ?? null;
    } catch {
      // Не смогли узнать — не страшно, спросим логин как обычно.
    }
  }

  if (existingLogin) {
    try {
      const { login } = await backendClient.reserveApplicationLogin({
        telegramId,
        login: existingLogin,
        authorName,
        resources,
      });
      ctx.session.authorAppLogin = login;
      ctx.session.authorAppLoginPreexisting = true;
      await showSummary(ctx);
      return;
    } catch (err) {
      // Бэкенд подтверждает: учётка уже есть — берём логин из ответа и
      // идём в сводку, а не спрашиваем заново.
      if (err instanceof AuthorApplicationError && err.message === 'credential_exists') {
        ctx.session.authorAppLogin = err.login ?? existingLogin;
        ctx.session.authorAppLoginPreexisting = true;
        await showSummary(ctx);
        return;
      }
      // Иная ошибка — падаем в обычный сценарий с ручным вводом.
    }
  }

  await askLogin(ctx);
}

export async function handleAuthorAppSubmit(ctx: CallbackCtx): Promise<void> {
  await ctx.answerCallbackQuery();

  const telegramId = ctx.from.id;
  const authorName = ctx.session.authorAppName;
  const resources = ctx.session.authorAppResources;
  const login = ctx.session.authorAppLogin;

  if (ctx.session.authorAppStep !== 'confirm' || !authorName || !login) {
    await ctx.reply('Сессия заявки устарела. Начните заново: /become_author');
    return;
  }
  if (resources.length === 0) {
    await ctx.reply('Укажите хотя бы один ресурс.', { reply_markup: resourcesKeyboard(0) });
    return;
  }

  try {
    await backendClient.submitAuthorApplication({ telegramId, authorName, resources, login });
  } catch (err) {
    if (err instanceof AuthorApplicationError) {
      logEvent({
        event: 'AUTHOR_APP_SUBMIT_REJECTED',
        requestId: ctx.requestId,
        telegramId,
        status: err.status,
        error: err.message,
      });
      // Логин заняли между сводкой и отправкой — вернуть к выбору логина.
      if (err.message === 'login_taken') {
        await ctx.reply('Пока вы заполняли заявку, этот логин заняли. Придумайте другой.');
        await askLogin(ctx);
        return;
      }
      await ctx.reply(translateError(err.message));
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
  await ctx.reply(
    'Заявка принята ✅.\n\n' +
      'Нам потребуется время на проверку информации. ' +
      'При необходимости администратор свяжется с вами.',
  );
}

export async function handleAuthorAppCancel(ctx: CallbackCtx): Promise<void> {
  await ctx.answerCallbackQuery();
  // Убираем черновик, чтобы освободить закреплённый логин. Best-effort:
  // если не удалось — подберёт фоновая уборка.
  await backendClient.discardApplicationDraft(ctx.from.id);
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
      await ctx.reply(translateError(err.message));
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
