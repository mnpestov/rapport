import { Bot } from 'grammy';
import { config } from '../config';
import type { CustomContext } from './context';
import { updateLogger } from './middleware/updateLogger';
import { handleStart } from './handlers/start';
import { handleDiagnosticStart, handleDiagnosticRetry, handleEscalate } from './handlers/callbackQuery';
import { handleFallback } from './handlers/fallback';

export function createBot(): Bot<CustomContext> {
  const bot = new Bot<CustomContext>(config.botToken, {
    client: { apiRoot: config.telegramApiRoot },
  });

  bot.use(updateLogger);

  bot.command('start', handleStart);
  bot.callbackQuery('diagnostic:start', handleDiagnosticStart);
  bot.callbackQuery('diagnostic:retry', handleDiagnosticRetry);
  bot.callbackQuery('support:escalate', handleEscalate);
  bot.on('message', handleFallback);

  return bot;
}
