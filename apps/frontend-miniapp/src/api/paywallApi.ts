import { API_URL } from "./config";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { getAuthHeaders } from "./authApi";

// Fire-and-forget, same as trackPatternView and the rest of analyticsApi —
// never blocks UI, never surfaces an error to the user on failure. Called
// once when the banner renders, and again with clicked=true if the user
// taps the CTA (PAYWALL_BANNER_PLAN.md §7) — at most twice per banner
// lifecycle.
export const submitPaywallImpression = async (clicked?: boolean): Promise<void> => {
  try {
    const response = await fetchWithTimeout(
      `${API_URL}/analytics/paywall-impression`,
      {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(clicked ? { clicked: true } : {}),
      },
      5000
    );
    if (!response.ok) {
      console.error(`[Paywall] Failed to record impression: ${response.status}`);
    }
  } catch (error) {
    console.error("[Paywall] Network error recording impression:", error);
  }
};

// Значения обязаны совпадать с enum-ами PaywallEventType/PaywallSource в
// schema.prisma — бэкенд отвергает всё, чего нет в enum, чтобы мусор не
// попал в выборку и не исказил отчёт.
export type PaywallEventType =
  | "SHOWN"
  | "SCROLLED_TO_END"
  | "SUBSCRIBE_CLICK"
  | "CLOSED"
  | "BUTTON_OPENED";

export type PaywallSource =
  | "AUTO_BANNER"
  | "SEARCH_BUTTON"
  // Тап по платной секции в шторке фильтров (цена / толщина пряжи /
  // плотность). Отдельный источник, а не SEARCH_BUTTON: это другое
  // намерение — человек пришёл за конкретной функцией, и смешивать его с
  // теми, кто просто открыл баннер кнопкой, значит потерять самый
  // показательный сегмент воронки (§10.3).
  | "FILTER_LOCK"
  | "EXPIRING_3_DAYS"
  | "EXPIRING_1_DAY"
  | "ACTIVE";

// Отдельно от submitPaywallImpression намеренно: тот пишет функциональное
// поле, на котором висит 7-дневный кулдаун показа, а это — append-only лог
// для воронки. Смешивать нельзя, иначе чистка статистики сломала бы логику
// показа (PAYMENTS_ROBOKASSA_PLAN.md §10.1).
export const submitPaywallEvent = async (
  type: PaywallEventType,
  source: PaywallSource
): Promise<void> => {
  try {
    await fetchWithTimeout(
      `${API_URL}/analytics/paywall-event`,
      {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ type, source }),
      },
      5000
    );
  } catch (error) {
    // Осознанно молча: часть событий будет теряться (сеть, закрытие
    // приложения), и верх воронки systematically занижен — это заложено в
    // §10.6. Ронять из-за аналитики ничего нельзя.
    console.error("[Paywall] Network error recording event:", error);
  }
};
