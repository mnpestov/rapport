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
}

export interface DashboardResponse {
  stats: DashboardStats;
  topByViews: TopPatternItem[];
  topByLinkClicks: TopPatternItem[];
  topByFavorites: TopPatternItem[];
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
  retention: PaywallFunnelStep;
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
  | "PAID";

export type PaywallScope = "all" | "acquisition" | "retention" | "filter_lock" | "search_button";

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
  params: FetchParams & { metric: PaywallMetric; scope?: PaywallScope; limit?: number; offset?: number }
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

  const response = await fetchWithAuth(`${API_URL}/admin/paywall-stats/users?${q}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch paywall stats users: ${response.statusText}`);
  }
  return response.json();
};
