import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export type Period = "7d" | "30d" | "90d" | "all" | "custom";

export interface TopPatternItem {
  patternId: string;
  title: string;
  authorName: string;
  url: string;
  count: number;
}

export interface TopAuthorItem {
  authorId: string;
  name: string;
  count: number;
}

export interface TopSearchQueryItem {
  query: string;
  count: number;
}

export interface DashboardStats {
  totalUsers: number;
  newUsersInPeriod: number;
  totalPatternViews: number;
  totalPatternLinkClicks: number;
  totalSubscribeClicks: number;
  totalFavorites: number;
  totalPriceAlerts: number;
}

export interface DashboardResponse {
  stats: DashboardStats;
  topByViews: TopPatternItem[];
  topByLinkClicks: TopPatternItem[];
  topByFavorites: TopPatternItem[];
  topByPriceAlerts: TopPatternItem[];
  topAuthorsByViews: TopAuthorItem[];
  topAuthorsByLinkClicks: TopAuthorItem[];
  topAuthorsByFavorites: TopAuthorItem[];
  topSearchQueries: TopSearchQueryItem[];
  generatedAt: string;
}

type FetchParams =
  | { period: Exclude<Period, "custom"> }
  | { from: string; to: string };

export const getDashboardStats = async (
  params: FetchParams
): Promise<DashboardResponse> => {
  const query =
    "from" in params
      ? `from=${params.from}&to=${params.to}`
      : `period=${params.period}`;

  const response = await fetchWithAuth(
    `${API_URL}/admin/dashboard/stats?${query}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard stats: ${response.statusText}`);
  }

  return response.json();
};

// Воронка подписки (PAYMENTS_ROBOKASSA_PLAN.md §10). Тот же контракт
// периода, что у getDashboardStats — виджет подчиняется общему
// переключателю на дашборде, а не заводит свой.
export interface PaywallFunnelStep {
  shown: number;
  subscribeClick: number;
  paid: number;
}

// Удержание — воронка "% продлений": верх не показы баннера, а платные
// подписчики за период (у кого подписка была активна в диапазоне), дальше
// те же шаги, что у привлечения (показали баннер продления → нажали
// «Оформить» → оплатили).
export interface RetentionFunnelStep extends PaywallFunnelStep {
  activeSubscribers: number;
  // Кому баннер ДОЛЖЕН показаться прямо сейчас (premiumExpiresAt ≤ 3 дня
  // от текущего момента) — часть подписчиков не заходит в Раппорт в этом
  // окне и никогда не попадает в "shown" (тот считается по PaywallEvent,
  // который создаётся только при открытии сессии). Мгновенный снимок, не
  // зависит от периода на дашборде.
  eligibleForBanner: number;
}

export interface PaywallStatsResponse {
  events: {
    shown: number;
    scrolledToEnd: number;
    subscribeClick: number;
    closed: number;
    // Ручные открытия шторки разделены по источнику: кнопка у поиска и
    // замок на платной секции фильтров — разные намерения, и подпись у
    // каждой плашки своя.
    buttonOpened: number;
    buttonOpenedFromFilters: number;
  };
  // Привлечение и удержание разделены: у них разный знаменатель и разный
  // смысл, складывать нельзя.
  acquisition: PaywallFunnelStep;
  retention: RetentionFunnelStep;
  // Сводка в шапке виджета — "сейчас платят" vs "ушли за период", отдельно
  // от воронки (там шаги конверсии, тут статус). activeSubscribers дублирует
  // retention.activeSubscribers намеренно — так шапка не зависит от формы
  // воронки, если та когда-нибудь изменится.
  summary: {
    activeSubscribers: number;
    churnedSubscribers: number;
  };
  // Оплаты, созданные до появления атрибуции — источника у них нет и задним
  // числом не будет. Показываются отдельно, чтобы сумма по воронкам не
  // выглядела расходящейся с общим числом оплат.
  paidWithoutSource: number;
}

export const getPaywallStats = async (
  params: FetchParams
): Promise<PaywallStatsResponse> => {
  const query =
    "from" in params
      ? `from=${params.from}&to=${params.to}`
      : `period=${params.period}`;

  const response = await fetchWithAuth(`${API_URL}/admin/paywall-stats?${query}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch paywall stats: ${response.statusText}`);
  }

  return response.json();
};

// Детализация метрики — кто именно стоит за цифрой на дашборде.
export type PaywallMetric =
  | "SHOWN"
  | "SCROLLED_TO_END"
  | "SUBSCRIBE_CLICK"
  | "CLOSED"
  | "BUTTON_OPENED"
  | "PAID"
  // Верх воронки удержания — платные подписчики за период (была активна
  // КОГДА-ТО в периоде, даже если уже истекла), User по premiumExpiresAt,
  // не PaywallEvent/Payment.
  | "ACTIVE_SUBSCRIBERS"
  // Строка над "Показали баннер" — кому баннер ДОЛЖЕН показаться прямо
  // сейчас (premiumExpiresAt в ближайшие 3 дня), не привязано к периоду.
  | "ELIGIBLE_FOR_RENEWAL_BANNER"
  // Сводка в шапке — активна ПРЯМО СЕЙЧАС. Не то же самое, что
  // ACTIVE_SUBSCRIBERS выше — см. комментарий в paywallStatsController.ts.
  | "CURRENTLY_ACTIVE_SUBSCRIBERS"
  // Сводка в шапке — подписка истекла в период и сейчас не активна.
  | "CHURNED_SUBSCRIBERS";

export type PaywallScope =
  | "all"
  | "acquisition"
  | "retention"
  // Шаг "показали баннер продления" в воронке удержания — исключает
  // source=ACTIVE (ручное открытие кнопкой у поиска подписчиком), см.
  // RETENTION_AUTO_SHOWN_SOURCES на бэкенде.
  | "retention_auto_shown"
  | "filter_lock"
  | "search_button";

export interface PaywallStatsUser {
  userId: string;
  telegramId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  // Сколько раз событие случилось у этого человека за период (для PAID
  // всегда 1 — там строка на платёж).
  count: number;
  lastAt: string | null;
  amount?: number;
  invId?: number;
}

export interface PaywallStatsUsersResponse {
  total: number;
  items: PaywallStatsUser[];
}

export const getPaywallStatsUsers = async (
  params: FetchParams & {
    metric: PaywallMetric;
    scope?: PaywallScope;
    limit?: number;
    offset?: number;
    // Только для ACTIVE_SUBSCRIBERS — клик по заголовку "Срок действия" в
    // PaywallUsersModal. Другие метрики сортируются как раньше (по времени
    // последнего события), бэкенд игнорирует параметр для них.
    sortOrder?: "asc" | "desc";
  }
): Promise<PaywallStatsUsersResponse> => {
  const q = new URLSearchParams();
  if ("from" in params) {
    q.set("from", params.from);
    q.set("to", params.to);
  } else {
    q.set("period", params.period);
  }
  q.set("metric", params.metric);
  if (params.scope) q.set("scope", params.scope);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  if (params.sortOrder) q.set("sortOrder", params.sortOrder);

  const response = await fetchWithAuth(`${API_URL}/admin/paywall-stats/users?${q}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch paywall stats users: ${response.statusText}`);
  }
  return response.json();
};

// Кто подписался на снижение цены конкретного описания — детализация
// плашки "Топ по подписке на цену". Тот же формат ответа, что у
// getPaywallStatsUsers (PaywallStatsUser[]), переиспользует PaywallUsersModal.
export const getPatternPriceAlertSubscribers = async (
  patternId: string
): Promise<PaywallStatsUsersResponse> => {
  const response = await fetchWithAuth(
    `${API_URL}/admin/patterns/${patternId}/price-alert-subscribers`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch price alert subscribers: ${response.statusText}`);
  }
  return response.json();
};

// "Реальная" аудитория — сегментация по факту просмотра карточки, а не по
// голому count(User). Дорогой запрос (сканирует PatternView), вызывается
// только по клику "Обновить" на странице статистики, не при каждом
// открытии.
export interface UserActivitySegments {
  paid: number;
  active: number;
  sleeping: number;
  dead: number;
  churned: number;
}

export interface UserActivityWeeklyPoint {
  week: string;
  newUsers: number;
  activeUsers: number;
}

export interface UserActivityCohort {
  week: string;
  cohortSize: number;
  returnedD7Plus: number;
}

export interface UserActivitySegmentsResponse {
  segments: UserActivitySegments;
  weekly: UserActivityWeeklyPoint[];
  cohorts: UserActivityCohort[];
  generatedAt: string;
}

export const getUserActivitySegments = async (): Promise<UserActivitySegmentsResponse> => {
  const response = await fetchWithAuth(`${API_URL}/admin/users/activity-segments`);
  if (!response.ok) {
    throw new Error(`Failed to fetch user activity segments: ${response.statusText}`);
  }
  return response.json();
};
