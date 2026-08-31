import { Permission, UserRole } from "@prisma/client";

/**
 * Общий post-auth слой: всё, что считается ОДИНАКОВО после любого успешного
 * входа — Mini App (initData), веб-OTP (verify-code), веб-логин/пароль.
 *
 * Извлечено из authController.telegramAuth без изменения поведения
 * (BROWSER_ACCESS_PLAN.md §4.3, этап 0). Пока единственный вызывающий —
 * сам telegramAuth; веб-пути подключатся на этапе 1.
 *
 * Здесь НЕТ гейта WEB_ACCESS: его делают вызывающие веб-эндпоинты до
 * вызова этого слоя (403 раньше, чем считаем подписку/paywall).
 */

// Ровно та форма, в которой authController уже читает пользователя:
// upsert(... include: { permissions: { select: { permission: true } } }).
export interface PaywallUserFields {
  role: UserRole;
  lastPaywallShownAt: Date | null;
  premiumExpiresAt: Date | null;
}

export interface PaywallState {
  isAdmin: boolean;
  paywallUiEnabled: boolean;
  showPaywallBanner: boolean;
  subscriptionWarning: "expiring_3_days" | "expiring_1_day" | null;
}

/**
 * Баннер подписки, предупреждения об истечении и общий выключатель платного
 * UI. Перенесено 1:1 из authController — включая все kill-switch'и и их
 * обоснования, см. PAYWALL_BANNER_PLAN.md §4/§5.1 и
 * PAYMENTS_ROBOKASSA_PLAN.md §7.
 *
 * allowDevAuth передаётся параметром, а не читается из env здесь: в
 * authController он уже вычислен один раз выше по коду, и дублировать
 * чтение process.env значило бы завести второй источник правды.
 */
export function buildPaywallState(params: {
  user: PaywallUserFields;
  permissions: string[];
  effectiveIsSubscriber: boolean;
  allowDevAuth: boolean;
}): PaywallState {
  const { user, permissions, effectiveIsSubscriber, allowDevAuth } = params;

  // ── Paywall banner gate ──────────────────────────────────────────────────
  // See PAYWALL_BANNER_PLAN.md §4/§5.1 — never shown to anyone with the
  // paid tier (PREMIUM_EXTRA), and at most once every 7 days.
  // Gated on effectiveIsSubscriber too: the frontend never reaches the
  // catalog/modal render for anyone who fails the channel-subscription
  // gate, so there's no point computing this for them.
  const isAdmin = user.role === UserRole.ADMIN;
  const hasExtra = isAdmin || permissions.includes(Permission.PREMIUM_EXTRA);
  // Kill-switch (PAYMENTS_ROBOKASSA_PLAN.md §7 шаг 5/7a): until public
  // launch, only admins can see the banner at all — this is what lets the
  // real Robokassa payment flow be tested end-to-end on prod (шаг 8)
  // without exposing anything to regular users, who all already have
  // PREMIUM_CORE today and would otherwise see the banner the moment this
  // ships.
  const paywallPubliclyLaunched = process.env.PAYWALL_BANNER_PUBLIC_LAUNCH === "true";
  // Единственный выключатель на ВСЕ платные элементы интерфейса: баннер,
  // предупреждения об истечении и кнопку подписки в строке поиска. Пока
  // флаг выключен, обычный пользователь не видит ничего из этого и
  // работает ровно как раньше; админ видит всё — это и позволяет
  // тестировать на проде до публичного запуска. Держать проверку одну на
  // все три поверхности принципиально: разъехавшись, они дали бы
  // состояние вроде "кнопка есть, а оплатить по ней нельзя".
  const paywallUiEnabled = paywallPubliclyLaunched || isAdmin;
  // ALLOW_DEV_AUTH включает и mock-авторизацию, и обход 7-дневного
  // кулдауна баннера — удобно, пока над баннером работают, но мешает
  // посмотреть на приложение глазами обычного пользователя: баннер
  // вылезает на каждой перезагрузке. Разделено: DEV_PAYWALL_COOLDOWN=true
  // возвращает локально настоящий кулдаун, не трогая mock-авторизацию.
  // На прод не влияет — там allowDevAuth всегда false, и обхода нет.
  const skipPaywallCooldown = allowDevAuth && process.env.DEV_PAYWALL_COOLDOWN !== "true";
  const showPaywallBanner =
    paywallUiEnabled &&
    effectiveIsSubscriber &&
    // Баннер "оформите подписку" — только тем, у кого платного доступа
    // НЕТ. Здесь раньше стоял обход `isAdmin || !hasExtra`: у админа
    // hasExtra всегда true (роль подразумевает все премиум-флаги), и без
    // обхода баннер был недостижим для аккаунта, которым его и нужно было
    // проверять на шагах 6/8. После реальной оплаты это стало вредить —
    // владельцу действующей подписки предлагалось её оформить. Обход
    // убран: посмотреть любую шторку можно кнопкой подписки в строке
    // поиска, не подменяя смысл автопоказа.
    !hasExtra &&
    // Локально кулдаун по умолчанию не действует (см. skipPaywallCooldown
    // выше) — баннер открывается на каждый вход, пока над ним работают.
    // В проде всегда действует настоящий, в том числе для админа.
    //
    // Раньше здесь стоял ещё и обход `isAdmin ||`: на шагах 6/8 нужно
    // было многократно прогонять оплату на проде, а одного показа
    // достаточно, чтобы paywallController проставил lastPaywallShownAt и
    // закрыл баннер на неделю. Убран после завершения тестирования —
    // открыть шторку вручную теперь можно кнопкой подписки в строке
    // поиска, ради чего ломать частоту показа больше незачем.
    (skipPaywallCooldown ||
      user.lastPaywallShownAt === null ||
      Date.now() - user.lastPaywallShownAt.getTime() >= 7 * 24 * 60 * 60 * 1000);

  // ── Предупреждение об истечении подписки ─────────────────────────────────
  // Считается на бэкенде по той же причине, что и showPaywallBanner: фронт
  // получает готовое решение, а не сырую дату, которую пришлось бы
  // интерпретировать в двух местах. Не пересекается с баннером — тот
  // показывается только тем, у кого доступа НЕТ, а это, наоборот, только
  // действующим подписчикам. Пороги совпадают с cron-напоминанием в бот
  // (checkSubscriptions.ts, 3 дня), плюс отдельный "последний день".
  let subscriptionWarning: "expiring_3_days" | "expiring_1_day" | null = null;
  if (paywallUiEnabled && effectiveIsSubscriber && user.premiumExpiresAt) {
    const msLeft = user.premiumExpiresAt.getTime() - Date.now();
    if (msLeft > 0) {
      const daysLeft = msLeft / (24 * 60 * 60 * 1000);
      if (daysLeft <= 1) subscriptionWarning = "expiring_1_day";
      else if (daysLeft <= 3) subscriptionWarning = "expiring_3_days";
    }
  }

  return { isAdmin, paywallUiEnabled, showPaywallBanner, subscriptionWarning };
}
