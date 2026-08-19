import { API_URL } from "./config";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { getAuthHeaders } from "./authApi";

// POST /payments/create — creates a Payment (PENDING) and returns the signed
// Robokassa redirect URL. Amount is a backend constant, nothing to send here.
export const createPayment = async (): Promise<string> => {
  const response = await fetchWithTimeout(`${API_URL}/payments/create`, {
    method: "POST",
    headers: getAuthHeaders(),
  }, 8000);
  if (!response.ok) throw new Error(`Failed to create payment: ${response.status}`);
  const data = await response.json();
  return data.paymentUrl as string;
};
