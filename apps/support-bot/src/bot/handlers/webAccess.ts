import { InlineKeyboard } from 'grammy';
import type { Filter } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';
import { BackendClient, UserCredentialError } from '../../services/backendClient';

type CallbackCtx = Filter<CustomContext, 'callback_query:data'>;

const backendClient = new BackendClient();

// Совпадает с валидацией на бэкенде (userCredentialController.ts). Бот —
// UX-слой, а не граница безопасности: проверяем здесь ради понятной ошибки
// сразу, но решает всё равно сервер.
const LOGIN_MIN = 3;
const LOGIN_MAX = 30;
const LOGIN_RE = /^[a-zA-Z0-9._-]+$/;

const SITE_URL = 'https://rapport.su';

const CANCEL_KEYBOARD = new InlineKeyboard().text('Отмена', 'web_access:cancel');

// Учётка уже есть — генерировать нечего, показываем что можно сделать.
const EXISTING_KEYBOARD = new InlineKeyboard()
  .url('Открыть сайт', SITE_URL).row()
  .text('Я забыл пароль', 'web_access:forgot');

function startMessage(): string {
  return [
    'Вход на сайт rapport.su',
    '',
    'Придумайте логин — по нему вы будете входить в браузере.',
    `Латинские буквы, цифры, точка, дефис или подчёркивание, от ${LOGIN_MIN} до ${LOGIN_MAX} символов.`,
    '',
    'Пароль сгенерирую я — его нужно будет сменить при первом входе.',
  ].join('\n');
}

/** Кнопка «Войти на сайте» в /start и команда /login. */
export async function handleWebAccessBegin(ctx: CustomContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Вызывается и командой /login, и кнопкой из /start. Во втором случае
  // callback нужно закрыть, иначе на кнопке остаются «часики».
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();

  logEvent({
    event: 'COMMAND_RECEIVED',
    requestId: ctx.requestId,
    telegramId,
    username: ctx.from?.username ?? null,
    command: 'web_access',
  });

  // Учётка может уже существовать — в том числе выданная админом как
  // автору (логин там машинный, из имени автора). Проверяем наличие ЛЮБОЙ
  // учётки, а не только заведённой через бота: иначе автор попал бы в
  // диалог «придумайте логин» и получил бы 409 в конце.
  let existing: { login: string; mustChangePassword: boolean } | null = null;
  try {
    existing = await backendClient.lookupUserCredential(telegramId);
  } catch (err) {
    console.error('[webAccess] lookup failed:', err);
    await ctx.reply('Не удалось проверить учётную запись. Попробуйте позже.');
    return;
  }

  if (existing) {
    await ctx.reply(
      [
        'У вас уже есть учётная запись для входа на сайт.',
        '',
        `Логин: <code>${existing.login}</code>`,
        existing.mustChangePassword
          ? '\nПри первом входе потребуется сменить временный пароль.'
          : '',
      ].filter(Boolean).join('\n'),
      { parse_mode: 'HTML', reply_markup: EXISTING_KEYBOARD },
    );
    return;
  }

  ctx.session.webAccessStep = 'login';
  await ctx.reply(startMessage(), { reply_markup: CANCEL_KEYBOARD });
}

export async function handleWebAccessCancel(ctx: CallbackCtx): Promise<void> {
  ctx.session.webAccessStep = undefined;
  await ctx.answerCallbackQuery();
  await ctx.reply('Отменено. Вернуться к созданию логина — /login');
}

export async function handleWebAccessForgot(ctx: CallbackCtx): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    [
      'Сброс пароля — на самой странице входа:',
      '',
      `1. Откройте ${SITE_URL}`,
      '2. Нажмите «Забыли пароль?»',
      '3. Введите свой логин — я пришлю сюда код подтверждения.',
    ].join('\n'),
    { reply_markup: new InlineKeyboard().url('Открыть сайт', SITE_URL) },
  );
}

/**
 * Шаг диалога: пользователь прислал логин.
 *
 * Возвращает true, если сообщение поглощено этим флоу — тогда fallback.ts
 * не обрабатывает его дальше (иначе текст ушёл бы в поддержку как обычное
 * обращение).
 */
export async function handleWebAccessStep(ctx: CustomContext): Promise<boolean> {
  if (ctx.session.webAccessStep !== 'login') return false;

  const telegramId = ctx.from?.id;
  const text = ctx.message?.text?.trim();
  if (!telegramId || text === undefined) return false;

  if (text.length < LOGIN_MIN || text.length > LOGIN_MAX) {
    await ctx.reply(
      `Логин должен быть от ${LOGIN_MIN} до ${LOGIN_MAX} символов. Попробуйте ещё раз.`,
      { reply_markup: CANCEL_KEYBOARD },
    );
    return true;
  }
  if (!LOGIN_RE.test(text)) {
    await ctx.reply(
      'Только латинские буквы, цифры, точка, дефис и подчёркивание — без пробелов. Попробуйте ещё раз.',
      { reply_markup: CANCEL_KEYBOARD },
    );
    return true;
  }

  try {
    const { login, password } = await backendClient.createUserCredential({
      telegramId,
      login: text,
      username: ctx.from?.username ?? null,
      firstName: ctx.from?.first_name ?? null,
      lastName: ctx.from?.last_name ?? null,
    });

    ctx.session.webAccessStep = undefined;

    // Пароль показывается один раз — сервер хранит только его хэш и
    // повторно прислать не сможет (только сбросить).
    await ctx.reply(
      [
        '✅ Готово! Данные для входа на сайт:',
        '',
        `Логин: <code>${login}</code>`,
        `Пароль: <code>${password}</code>`,
        '',
        'Пароль временный — при первом входе сайт попросит задать свой.',
        'Сохраните эти данные: повторно прислать пароль я не смогу, только сбросить.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().url('Открыть сайт', SITE_URL),
      },
    );

    logEvent({
      event: 'REPLY_SENT',
      requestId: ctx.requestId,
      telegramId,
      replyType: 'web_access_credentials',
    });
    return true;
  } catch (err) {
    if (err instanceof UserCredentialError) {
      if (err.code === 'login_taken') {
        await ctx.reply('Такой логин уже занят. Придумайте другой.', {
          reply_markup: CANCEL_KEYBOARD,
        });
        return true;
      }
      if (err.code === 'credential_exists') {
        // Гонка: учётка появилась между lookup в начале диалога и этим
        // запросом (второй чат / второе устройство).
        ctx.session.webAccessStep = undefined;
        await ctx.reply(
          err.login
            ? `У вас уже есть учётная запись. Логин: <code>${err.login}</code>`
            : 'У вас уже есть учётная запись для входа на сайт.',
          { parse_mode: 'HTML', reply_markup: EXISTING_KEYBOARD },
        );
        return true;
      }
      // Прочие 4xx — например, валидация не сошлась с серверной.
      await ctx.reply('Не удалось создать логин. Попробуйте другой вариант.', {
        reply_markup: CANCEL_KEYBOARD,
      });
      return true;
    }

    console.error('[webAccess] createUserCredential failed:', err);
    await ctx.reply('Не удалось создать учётную запись. Попробуйте позже.');
    return true;
  }
}
