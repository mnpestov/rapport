import type { Filter } from 'grammy';
import { logEvent } from '../../logger';
import type { CustomContext } from '../context';
import { BackendClient } from '../../services/backendClient';

type CallbackCtx = Filter<CustomContext, 'callback_query:data'>;

const backendClient = new BackendClient();

// Follow-up текст зависит от причины — см. план в чате (сентябрь 2026):
// "не нашла описание" — сигнал про контент/поиск, без обещания бонуса;
// "сложно пользоваться" — единственная ветка с материальным стимулом,
// потому что UX-фидбек самый ценный и затратный по усилиям для человека;
// "всё хорошо" — без призыва к действию, это и есть "мягко".
export async function handleWinbackDidntFind(ctx: CallbackCtx): Promise<void> {
  const telegramId = ctx.from.id;
  logEvent({ event: 'WINBACK_RESPONSE', requestId: ctx.requestId, telegramId, reason: 'DIDNT_FIND_PATTERN' });

  await ctx.answerCallbackQuery();

  try {
    await backendClient.recordWinbackResponse(telegramId, 'DIDNT_FIND_PATTERN');
  } catch (err) {
    logEvent({ event: 'WINBACK_RECORD_ERROR', requestId: ctx.requestId, telegramId, error: (err as Error).message });
  }

  // Ждём следующее текстовое сообщение — см. fallback.ts,
  // ctx.session.awaitingWinbackFeedback. Без бонуса, только учёт.
  ctx.session.awaitingWinbackFeedback = 'didnt_find';

  await ctx.reply(
    'Расскажите, что искали — учтём при пополнении каталога. Просто напишите в ответ.',
  );
}

export async function handleWinbackHardToUse(ctx: CallbackCtx): Promise<void> {
  const telegramId = ctx.from.id;
  logEvent({ event: 'WINBACK_RESPONSE', requestId: ctx.requestId, telegramId, reason: 'HARD_TO_USE' });

  await ctx.answerCallbackQuery();

  try {
    await backendClient.recordWinbackResponse(telegramId, 'HARD_TO_USE');
  } catch (err) {
    logEvent({ event: 'WINBACK_RECORD_ERROR', requestId: ctx.requestId, telegramId, error: (err as Error).message });
  }

  // Ждём следующее текстовое сообщение — см. fallback.ts. Эта ветка (и
  // только она) начисляет бонус +14 дней при получении текста.
  ctx.session.awaitingWinbackFeedback = 'hard_to_use';

  await ctx.reply(
    'Жаль это слышать — расскажите подробнее, что показалось неудобным? ' +
    'За развёрнутый отзыв подарим +14 дней к вашей подписке.',
  );
}

// Кнопка "Оставить обратную связь" под checkDormant.ts-сообщением (не
// задаёт вопрос про причину отвала, в отличие от остальных winback-кнопок
// выше) — просто открывает свободный текстовый ввод, без бонуса и без
// recordWinbackResponse (WinbackReason не описывает "написал сам, без
// повода", см. context.ts).
export async function handleDormantFeedback(ctx: CallbackCtx): Promise<void> {
  const telegramId = ctx.from.id;
  logEvent({ event: 'WINBACK_RESPONSE', requestId: ctx.requestId, telegramId, reason: 'DORMANT_FEEDBACK' });

  await ctx.answerCallbackQuery();

  ctx.session.awaitingWinbackFeedback = 'dormant_feedback';

  await ctx.reply('Напишите нам, прямо сюда в чат, что можно улучшить или что вам не понравилось. Мы обязательно прочитаем ❤️');
}

export async function handleWinbackAllGood(ctx: CallbackCtx): Promise<void> {
  const telegramId = ctx.from.id;
  logEvent({ event: 'WINBACK_RESPONSE', requestId: ctx.requestId, telegramId, reason: 'ALL_GOOD' });

  await ctx.answerCallbackQuery();

  try {
    await backendClient.recordWinbackResponse(telegramId, 'ALL_GOOD');
  } catch (err) {
    logEvent({ event: 'WINBACK_RECORD_ERROR', requestId: ctx.requestId, telegramId, error: (err as Error).message });
  }

  await ctx.reply('Хорошо, ждём! 🙂');
}

// Свободный текст после кнопки "не нашла описание"/"сложно пользоваться" —
// вызывается из fallback.ts, пока ctx.session.awaitingWinbackFeedback
// установлен. true = сообщение обработано здесь, fallback.ts не должен
// падать дальше в свою обычную логику (сохранение в поддержку/приветствие).
export async function handleWinbackFeedbackStep(ctx: CustomContext): Promise<boolean> {
  const step = ctx.session.awaitingWinbackFeedback;
  if (!step) return false;

  const telegramId = ctx.from?.id;
  const text = ctx.message?.text?.trim();
  if (!telegramId || !text) return false;

  ctx.session.awaitingWinbackFeedback = undefined;

  logEvent({ event: 'WINBACK_FEEDBACK_TEXT', requestId: ctx.requestId, telegramId, step, textLength: text.length });

  try {
    await backendClient.saveMessage({
      telegramId,
      username: ctx.from?.username ?? null,
      firstName: ctx.from?.first_name ?? null,
      messageType: `winback_feedback:${step}`,
      text,
    });
  } catch (err) {
    logEvent({ event: 'WINBACK_FEEDBACK_SAVE_ERROR', requestId: ctx.requestId, telegramId, error: (err as Error).message });
  }

  if (step === 'didnt_find') {
    await ctx.reply('Спасибо! Передали в работу — учтём при пополнении каталога.');
    return true;
  }

  if (step === 'dormant_feedback') {
    await ctx.reply('Спасибо за обратную связь! Обязательно почитаем 🙂');
    return true;
  }

  // hard_to_use — начисляем бонус за развёрнутый отзыв. Автоматически, по
  // факту получения текста, без модерации (решено в чате, сентябрь 2026:
  // "если отзыв будет спамом — сможем отозвать").
  try {
    await backendClient.grantWinbackBonus(telegramId);
    await ctx.reply(
      'Спасибо большое за подробный отзыв! ' +
      'Передали в работу — постараемся сделать приложение удобнее.',
    );
  } catch (err) {
    logEvent({ event: 'WINBACK_BONUS_ERROR', requestId: ctx.requestId, telegramId, error: (err as Error).message });
    await ctx.reply(
      'Спасибо большое за подробный отзыв! Бонус к подписке начислим в ближайшее время.',
    );
  }
  return true;
}

export async function handleWinbackOptOut(ctx: CallbackCtx): Promise<void> {
  const telegramId = ctx.from.id;
  logEvent({ event: 'WINBACK_OPT_OUT', requestId: ctx.requestId, telegramId });

  await ctx.answerCallbackQuery();

  try {
    await backendClient.optOutWinback(telegramId);
  } catch (err) {
    logEvent({ event: 'WINBACK_OPT_OUT_ERROR', requestId: ctx.requestId, telegramId, error: (err as Error).message });
  }

  await ctx.reply('Хорошо, больше не будем спрашивать. Мы всегда на месте 🙂');
}
