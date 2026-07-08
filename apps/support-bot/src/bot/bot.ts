import { Bot, session } from 'grammy';
import { config } from '../config';
import type { CustomContext, SessionData } from './context';
import { updateLogger } from './middleware/updateLogger';
import { handleStart } from './handlers/start';
import { handleDiagnosticStart, handleDiagnosticRetry, handleEscalate, handleCacheFailed } from './handlers/callbackQuery';
import { handleFallback } from './handlers/fallback';

export function createBot(): Bot<CustomContext> {
  const bot = new Bot<CustomContext>(config.botToken, {
    client: { apiRoot: config.telegramApiRoot },
  });

  bot.use(updateLogger);
  bot.use(session({ initial: (): SessionData => ({ awaitingScreenshot: false }) }));

  bot.command('start', handleStart);
  bot.callbackQuery('diagnostic:start', handleDiagnosticStart);
  bot.callbackQuery('diagnostic:retry', handleDiagnosticRetry);
  bot.callbackQuery('support:escalate', handleEscalate);
  bot.callbackQuery('support:cache_failed', handleCacheFailed);
  bot.on('message', handleFallback);

  return bot;
}
