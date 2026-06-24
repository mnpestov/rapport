import { API_URL } from "./config";

export interface TopPatternItem {
  patternId: string;
  title: string;
  count: number;
}

export interface DashboardStats {
  totalUsers: number;
  newUsersLast7Days: number;
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

export const getDashboardStats = async (): Promise<DashboardResponse> => {
  const token = localStorage.getItem("jwt_token");
  const response = await fetch(`${API_URL}/admin/dashboard/stats`, {
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
