import { logEvent } from '../logger';
import { config } from '../config';
import type { CustomContext } from './context';

export async function notifyAdmin(ctx: CustomContext, message: string): Promise<void> {
  const adminId = config.adminTelegramId;
  if (!adminId) return;
  try {
    await ctx.api.sendMessage(adminId, message, { parse_mode: 'HTML' });
  } catch (err) {
    logEvent({
      event: 'ADMIN_NOTIFY_ERROR',
      requestId: ctx.requestId,
      telegramId: ctx.from?.id ?? null,
      error: (err as Error).message,
    });
  }
}
