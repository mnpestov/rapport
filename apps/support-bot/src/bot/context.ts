import { Context, SessionFlavor } from 'grammy';

export interface SessionData {
  awaitingScreenshot?: boolean;
}

export interface CustomContext extends Context, SessionFlavor<SessionData> {
  requestId: string;
}
