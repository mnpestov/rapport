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
    buttonOpened: number;
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
