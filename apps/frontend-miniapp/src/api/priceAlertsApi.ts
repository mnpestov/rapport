import { API_URL } from "./config";
import { authorizedFetch } from "./authSession";

// Подписка на снижение цены описания (implementation_plan.md — «Подписка на цены»).
// По образцу favoritesApi.ts, с отличиями в обработке ошибок (см. ниже).

// GET /price-alerts → patternId[]. 403 (нет PRICE_ALERT) — не ошибка, а
// «нет доступа»: возвращаем пустой список, кнопку просто не показываем.
export const fetchPriceAlerts = async (): Promise<string[]> => {
  const response = await authorizedFetch(`${API_URL}/price-alerts`, {}, 8000);
  if (response.status === 403) return [];
  if (!response.ok) throw new Error(`Failed to fetch price alerts: ${response.status}`);
  const data = await response.json();
  return data.patternIds as string[];
};

// POST /price-alerts/:patternId. При ошибке пробрасываем текст из тела —
// компонент покажет его локально (лимит 20 → 429 с { error }).
export const subscribePriceAlert = async (patternId: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/price-alerts/${patternId}`, {
    method: "POST",
  }, 8000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || "Не удалось подписаться на снижение цены");
  }
};

// DELETE /price-alerts/:patternId
export const unsubscribePriceAlert = async (patternId: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/price-alerts/${patternId}`, {
    method: "DELETE",
  }, 8000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || "Не удалось отписаться");
  }
};
