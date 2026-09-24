/**
 * Мягкий чекин платным подписчикам, переставшим заходить (winback, план в
 * чате — сентябрь 2026). Через тот же telegram-gateway, что и
 * authorNotifier.ts, generic-прокси `/bot:token/sendMessage` — нужны
 * inline-кнопки (`reply_markup`), а custom `/send-message`
 * (subscriptionNotifier.ts) их не поддерживает.
 *
 * Нажатия кнопок обрабатывает support-bot (единственный бот с вебхуком на
 * callback_query) — см. apps/support-bot/src/bot/handlers/winback.ts.
 */

// callback_data ИЛИ url — ровно один из двух, как того требует Telegram
// Bot API для inline-кнопки; DORMANT_KEYBOARD ниже использует url для
// "Войти в Раппорт" (открывает mini app напрямую, без support-bot).
type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export interface SendResult {
  delivered: boolean;
  // true — Telegram ответил кодом, означающим "этот чат навсегда
  // недостижим" (бот заблокирован, аккаунт удалён, чат не найден). Без
  // этого различения cron пытался бы слать сюда каждый день бесконечно:
  // winbackCheckinSentAt ставится только при delivered=true, а
  // недоставленное (delivered=false) — это сигнал "повторим завтра",
  // корректный только для ВРЕМЕННЫХ ошибок (5xx/таймаут), не для
  // навсегда заблокированного чата.
  permanentlyUnreachable: boolean;
}

// Коды Telegram Bot API, означающие "сюда больше никогда не достучаться":
// 403 — бот заблокирован пользователем или удалён из чата;
// 400 с описанием "chat not found" — chat_id стал невалиден (аккаунт
// удалён/деактивирован). Проверяем оба через тело ответа, а не только код,
// потому что 400 сам по себе бывает и по другим (временным) причинам.
function isPermanentFailure(status: number, body: string): boolean {
  if (status === 403) return true;
  if (status === 400 && /chat not found/i.test(body)) return true;
  return false;
}

async function sendMessage(
  telegramId: bigint,
  text: string,
  replyMarkup: { inline_keyboard: InlineKeyboardButton[][] }
): Promise<SendResult> {
  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const botToken = process.env.BOT_TOKEN;

  if (!baseUrl || !botToken) {
    console.log(`[WinbackNotifier] Gateway not configured — message for ${telegramId}:\n${text}`);
    return { delivered: false, permanentlyUnreachable: false };
  }

  try {
    const response = await fetch(`${baseUrl}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        chat_id: telegramId.toString(),
        text,
        reply_markup: replyMarkup,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const permanentlyUnreachable = isPermanentFailure(response.status, body);
      console.error(
        `[WinbackNotifier] Gateway API error for ${telegramId}: ${response.status} ${response.statusText}` +
          (permanentlyUnreachable ? " (постоянная ошибка — chat недостижим)" : " (временная, повторим завтра)")
      );
      console.error("[WinbackNotifier] Details:", body);
      return { delivered: false, permanentlyUnreachable };
    }
    return { delivered: true, permanentlyUnreachable: false };
  } catch (err) {
    console.error("[WinbackNotifier] Network error sending message to Gateway:", err);
    return { delivered: false, permanentlyUnreachable: false };
  }
}

// callback_data держим короткими и с общим префиксом "winback:" — support-bot
// маршрутизирует по нему в один хендлер вместо четырёх отдельных.
const KEYBOARD: { inline_keyboard: InlineKeyboardButton[][] } = {
  inline_keyboard: [
    [{ text: "Не нашла нужное описание", callback_data: "winback:didnt_find" }],
    [{ text: "Сложно пользоваться приложением", callback_data: "winback:hard_to_use" }],
    [{ text: "Всё хорошо, скоро вернусь", callback_data: "winback:all_good" }],
    [{ text: "Не спрашивать больше", callback_data: "winback:opt_out" }],
  ],
};

export async function sendWinbackCheckin(telegramId: bigint): Promise<SendResult> {
  const text =
    "Давно вас не было видно в Раппорте 🧶\n\n" +
    "Что-то не так, или просто закрутились в делах?";
  return sendMessage(telegramId, text, KEYBOARD);
}

// Своя клавиатура для checkDormant.ts — DORMANT_KEYBOARD ниже не задаёт
// вопрос про причину отвала (в отличие от KEYBOARD у обычного чекина),
// поэтому кнопки-действия, а не кнопки-ответы: перейти в приложение или
// сразу написать отзыв. "Не спрашивать больше" здесь намеренно нет — это
// разовое сообщение о росте каталога, не повторяющийся опрос, на который
// имеет смысл жать отказ.
const DORMANT_KEYBOARD: { inline_keyboard: InlineKeyboardButton[][] } = {
  inline_keyboard: [
    [{ text: "Войти в Раппорт", url: "https://t.me/rapportapp_bot/rapport" }],
    [{ text: "Оставить обратную связь", callback_data: "winback:dormant_feedback" }],
  ],
};

// Отдельный текст для checkDormant.ts (сегмент "Отвалившиеся" — последний
// просмотр 90+ дней назад, часто почти с запуска проекта): "давно вас не
// было" тут звучит странно для человека, который толком и не пользовался
// каталогом в его нынешнем виде. Текст здоровается, объясняет, зачем мы
// пишем (каталог заметно вырос), и прямо предлагает либо вернуться, либо
// оставить отзыв — в отличие от обычного чекина, тут нет вопроса "что
// случилось", поэтому и клавиатура другая (см. DORMANT_KEYBOARD).
export async function sendDormantCheckin(telegramId: bigint, patternsCount: number): Promise<SendResult> {
  // Округляем вниз до сотен ("больше 3600", не точное "3627") — точность
  // тут не создаёт доверия, а неровное число из рассылки в рассылку (по
  // мере роста каталога) выглядело бы дёргано.
  const roundedCount = Math.floor(patternsCount / 100) * 100;
  const text =
    "Привет! Давно не виделись!\n\n" +
    "За это время Раппорт заметно вырос:\n" +
    `В каталоге уже более ${roundedCount.toLocaleString("ru-RU")} вязальных описаний\n` +
    "Появились новые функции\n\n" +
    "Если вам чего-то не хватило или что-то не понравилось в приложении — напишите нам! " +
    "Будем рады обратной связи и постараемся всё исправить ❤️\n\n" +
    "А если давно не заглядывали — самое время заглянуть снова!";
  return sendMessage(telegramId, text, DORMANT_KEYBOARD);
}
