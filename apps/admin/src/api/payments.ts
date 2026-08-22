import { API_URL } from "./config";
import { fetchWithAuth } from "./fetchWithAuth";

export type PaymentStatus = "PENDING" | "PAID";

export type PaywallSource =
  | "AUTO_BANNER"
  | "SEARCH_BUTTON"
  | "FILTER_LOCK"
  | "EXPIRING_3_DAYS"
  | "EXPIRING_1_DAY"
  | "ACTIVE";

export interface AdminPayment {
  id: string;
  // Номер счёта в Robokassa — по нему платёж ищется в их личном кабинете.
  invId: number;
  amount: number;
  status: PaymentStatus;
  // null у платежей, созданных до появления атрибуции источника.
  source: PaywallSource | null;
  createdAt: string;
  paidAt: string | null;
  receiptSentAt: string | null;
  user: {
    id: string;
    telegramId: string;
    firstName: string;
    lastName: string | null;
    username: string | null;
  };
}

export interface PaymentsResponse {
  payments: AdminPayment[];
  total: number;
  // Сумма оплаченного по текущему фильтру.
  paidSum: number;
}

export const getPayments = async (params: {
  search?: string;
  status?: PaymentStatus | "";
  limit?: number;
  offset?: number;
}): Promise<PaymentsResponse> => {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.status) q.set("status", params.status);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  const res = await fetchWithAuth(`${API_URL}/admin/payments?${q}`);
  if (!res.ok) throw new Error(`Failed to fetch payments: ${res.statusText}`);
  return res.json();
};

export interface CheckResult {
  ok: boolean;
  stateCode?: number | null;
  stateLabel?: string;
  // true — расхождение найдено и исправлено: доступ выдан, счёт проведён.
  changed?: boolean;
  status?: PaymentStatus;
  message?: string;
}

// Спрашивает Robokassa о реальном состоянии счёта. Если деньги получены, а
// у нас PENDING — платёж проводится тут же (см. checkPaymentStatus на
// бэкенде), поэтому вызывающий должен перезагрузить список.
export const checkPaymentStatus = async (id: string): Promise<CheckResult> => {
  const res = await fetchWithAuth(`${API_URL}/admin/payments/${id}/check`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to check payment: ${res.statusText}`);
  return res.json();
};
