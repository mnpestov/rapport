import { API_URL } from "./config";

export type Period = "7d" | "30d" | "90d" | "all" | "custom";

export interface TopPatternItem {
  patternId: string;
  title: string;
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
  generatedAt: string;
}

type FetchParams =
  | { period: Exclude<Period, "custom"> }
  | { from: string; to: string };

export const getDashboardStats = async (params: FetchParams): Promise<DashboardResponse> => {
  const token = localStorage.getItem("jwt_token");
  const query = "from" in params
    ? `from=${params.from}&to=${params.to}`
    : `period=${params.period}`;

  const response = await fetch(`${API_URL}/admin/dashboard/stats?${query}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard stats: ${response.statusText}`);
  }
  return response.json();
};
