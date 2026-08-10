import { useEffect, useState } from "react";

// Reuses the "auth:ready" event authApi.ts already dispatches after every
// successful login (see saveAuthData) — no separate context/provider needed
// just to know whether to render premium-only UI (author link on the detail
// page, and eventually the price filter etc.). This is NOT the access
// boundary itself: the backend already omits premium data for non-admins
// regardless of what this returns, see PAID_TIER_ROLLOUT_PLAN.md §2.5/§3.1.
const readRole = (): string | undefined => {
  const raw = localStorage.getItem("user_data");
  if (!raw) return undefined;
  try {
    return (JSON.parse(raw) as { role?: string }).role;
  } catch {
    return undefined;
  }
};

export const useIsAdmin = (): boolean => {
  const [isAdmin, setIsAdmin] = useState(() => readRole() === "ADMIN");

  useEffect(() => {
    const onAuthReady = () => setIsAdmin(readRole() === "ADMIN");
    window.addEventListener("auth:ready", onAuthReady);
    return () => window.removeEventListener("auth:ready", onAuthReady);
  }, []);

  return isAdmin;
};
