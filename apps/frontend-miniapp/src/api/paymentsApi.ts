import { API_URL } from "./config";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { getAuthHeaders } from "./authApi";
import { PaywallSource } from "./paywallApi";

// POST /payments/create — creates a Payment (PENDING) and returns the signed
// Robokassa redirect URL. Amount is a backend constant, nothing to send here.
// source — откуда пользователь пришёл к оплате. Задним числом источник не
// восстановить, поэтому он идёт вместе с самим созданием платежа
// (PAYMENTS_ROBOKASSA_PLAN.md §10.3).
export const createPayment = async (source: PaywallSource): Promise<string> => {
  const response = await fetchWithTimeout(`${API_URL}/payments/create`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  }, 8000);
  if (!response.ok) throw new Error(`Failed to create payment: ${response.status}`);
  const data = await response.json();
  return data.paymentUrl as string;
};
