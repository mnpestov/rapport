import { Context, SessionFlavor } from 'grammy';

export interface SessionData {
  awaitingScreenshot?: boolean;
  // Author-application FSM (implementation_plan.md §6). fallback.ts checks
  // authorAppStep before its default handling, so any /start or other
  // command mid-flow still short-circuits normally (commands are matched
  // before bot.on('message', ...) in bot.ts).
  authorAppStep?: 'name' | 'resources';
  authorAppName?: string;
  authorAppResources: string[];
}

export interface CustomContext extends Context, SessionFlavor<SessionData> {
  requestId: string;
}
