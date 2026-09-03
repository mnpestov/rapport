import { useEffect, useState } from "react";

// Reuses the "auth:ready" event authApi.ts already dispatches after every
// successful login (see saveAuthData) — no separate context/provider needed
// just to know whether to render premium-only UI. This is NOT the access
// boundary itself: the backend already omits premium data for anyone
// without the matching permission regardless of what this returns — see
// PAID_TIER_PERMISSIONS_PLAN.md §3.4.
//
// Checks the actual PREMIUM_CORE/PREMIUM_EXTRA/PREMIUM_DETAILS flags, not
// just role — an ADMIN implicitly has all three (mirrors the backend's
// resolveRole semantics), but a regular user who was explicitly granted one
// flag must see exactly that flag's UI, not neither (the whole point of
// separating permission from role).
export interface PremiumAccess {
  isAdmin: boolean;
  core: boolean;
  extra: boolean;
  details: boolean;
  // Показывать ли вообще платные элементы интерфейса (кнопка подписки в
  // строке поиска). Считается на бэкенде одним флагом на все поверхности —
  // см. paywallUiEnabled в authController.ts. До публичного запуска true
  // только у админа, поэтому обычный пользователь платного UI не видит.
  paywallUiEnabled: boolean;
  // Показывать кнопку «Следить за ценой» на карточке описания.
  priceAlert: boolean;
}

const NO_ACCESS: PremiumAccess = { isAdmin: false, core: false, extra: false, details: false, paywallUiEnabled: false, priceAlert: false };

const readAccess = (): PremiumAccess => {
  const raw = localStorage.getItem("user_data");
  if (!raw) return NO_ACCESS;
  try {
    const data = JSON.parse(raw) as { role?: string; permissions?: string[]; paywallUiEnabled?: boolean };
    const isAdmin = data.role === "ADMIN";
    const permissions = data.permissions ?? [];
    return {
      isAdmin,
      core: isAdmin || permissions.includes("PREMIUM_CORE"),
      extra: isAdmin || permissions.includes("PREMIUM_EXTRA"),
      details: isAdmin || permissions.includes("PREMIUM_DETAILS"),
      paywallUiEnabled: Boolean(data.paywallUiEnabled),
      priceAlert: isAdmin || permissions.includes("PRICE_ALERT"),
    };
  } catch {
    return NO_ACCESS;
  }
};

export const usePremiumAccess = (): PremiumAccess => {
  const [access, setAccess] = useState(readAccess);

  useEffect(() => {
    const onAuthReady = () => setAccess(readAccess());
    window.addEventListener("auth:ready", onAuthReady);
    return () => window.removeEventListener("auth:ready", onAuthReady);
  }, []);

  return access;
};
