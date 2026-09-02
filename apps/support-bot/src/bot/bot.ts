import { Bot, session } from 'grammy';
import { config } from '../config';
import type { CustomContext, SessionData } from './context';
import { updateLogger } from './middleware/updateLogger';
import { handleStart } from './handlers/start';
import { handleDiagnosticStart, handleDiagnosticRetry, handleEscalate, handleCacheFailed } from './handlers/callbackQuery';
import { handleFallback } from './handlers/fallback';
import {
  handleBecomeAuthor,
  handleAuthorAppBegin,
  handleAuthorAppResourcesDone,
  handleAuthorAppChangeLogin,
  handleAuthorAppSubmit,
  handleAuthorAppCancel,
  handleAuthorAppRespondStart,
  handleAuthorAppRespondSubmit,
} from './handlers/authorApplication';
import {
  handleWebAccessBegin,
  handleWebAccessCancel,
  handleWebAccessForgot,
} from './handlers/webAccess';

// Shown in Telegram's "Menu" button next to the message input — the only
// UI surface where a user can discover /become_author without being told
// about it. Kept to the two commands users actually type; the diagnostic
// and author-application sub-flows are callback-button driven from here.
const BOT_COMMANDS = [
  { command: 'start', description: 'Начать' },
  { command: 'become_author', description: 'Подать заявку на авторский кабинет' },
  { command: 'login', description: 'Вход на сайт rapport.su' },
];

export function createBot(): Bot<CustomContext> {
  const bot = new Bot<CustomContext>(config.botToken, {
    client: { apiRoot: config.telegramApiRoot },
  });

  bot.use(updateLogger);
  bot.use(session({
    initial: (): SessionData => ({
      awaitingScreenshot: false,
      authorAppResources: [],
    }),
  }));

  bot.command('start', handleStart);
  bot.command('become_author', handleBecomeAuthor);
  bot.command('login', handleWebAccessBegin);
  bot.callbackQuery('diagnostic:start', handleDiagnosticStart);
  bot.callbackQuery('diagnostic:retry', handleDiagnosticRetry);
  bot.callbackQuery('support:escalate', handleEscalate);
  bot.callbackQuery('support:cache_failed', handleCacheFailed);
  bot.callbackQuery('author_app:begin', handleAuthorAppBegin);
  bot.callbackQuery('web_access:begin', handleWebAccessBegin);
  bot.callbackQuery('web_access:cancel', handleWebAccessCancel);
  bot.callbackQuery('web_access:forgot', handleWebAccessForgot);
  bot.callbackQuery('author_app:resources_done', handleAuthorAppResourcesDone);
  bot.callbackQuery('author_app:change_login', handleAuthorAppChangeLogin);
  bot.callbackQuery('author_app:submit', handleAuthorAppSubmit);
  bot.callbackQuery('author_app:cancel', handleAuthorAppCancel);
  bot.callbackQuery('author_app:respond_start', handleAuthorAppRespondStart);
  bot.callbackQuery('author_app:respond_submit', handleAuthorAppRespondSubmit);
  bot.on('message', handleFallback);

  return bot;
}

// Registered separately from createBot() (called once before bot.start()
// in index.ts) so a failure here — e.g. a transient Telegram API error —
// doesn't prevent the bot object itself from being constructed and wired up.
export async function registerBotCommands(bot: Bot<CustomContext>): Promise<void> {
  await bot.api.setMyCommands(BOT_COMMANDS);
}
