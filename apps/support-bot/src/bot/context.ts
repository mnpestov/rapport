import { Context, SessionFlavor } from 'grammy';

export interface SessionData {
  awaitingScreenshot?: boolean;
  // Author-application FSM (implementation_plan.md §6). fallback.ts checks
  // authorAppStep before its default handling, so any /start or other
  // command mid-flow still short-circuits normally (commands are matched
  // before bot.on('message', ...) in bot.ts).
  // 'respond' is a separate flow, not a resumption of 'name'/'resources':
  // it replies to an existing NEEDS_INFO application instead of creating a
  // new one (see /internal/bot/author-application/respond).
  authorAppStep?: 'name' | 'resources' | 'respond';
  authorAppName?: string;
  authorAppResources: string[];
  // Accumulated while in the 'respond' step (each message appended, one per
  // line — no attempt to separate "links" from "text", the backend stores
  // it as one free-text field), sent on "Отправить ✓".
  authorAppResponseText?: string;
  // Диалог получения логина для входа на сайт (BROWSER_ACCESS_PLAN.md §3.6).
  // Один шаг — пользователь присылает придуманный логин. fallback.ts обязан
  // знать про него, иначе сообщение уйдёт в поддержку как обычное
  // обращение вместо того, чтобы стать логином.
  //
  // Сессия in-memory без адаптера: незавершённый диалог теряется при
  // рестарте бота (а деплой рестартит его всегда). Для одного шага это
  // приемлемо — пользователь просто начнёт заново.
  webAccessStep?: 'login';
}

export interface CustomContext extends Context, SessionFlavor<SessionData> {
  requestId: string;
}
