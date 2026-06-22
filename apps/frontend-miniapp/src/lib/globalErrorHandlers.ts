/**
 * GLOBAL ERROR HANDLERS — temporary, remove after investigation.
 *
 * Registers window.onerror, unhandledrejection, and online/offline listeners.
 * Call once from main.tsx before rendering the React tree.
 */

import { diagLog } from "./diagnosticLogger";

export function registerGlobalErrorHandlers(): void {
  // Uncaught synchronous errors
  window.onerror = (message, source, lineno, colno, error) => {
    diagLog("UNCAUGHT_ERROR", String(message), {
      source: source ?? "",
      lineno: lineno ?? 0,
      colno: colno ?? 0,
      stack: error?.stack?.slice(0, 600) ?? "",
    });
    // Return false — do not suppress default browser error handling
    return false;
  };

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    diagLog("UNHANDLED_REJECTION", String(reason?.message ?? reason), {
      stack:
        reason instanceof Error ? (reason.stack?.slice(0, 600) ?? "") : "",
    });
  });

  // Network state changes
  window.addEventListener("offline", () => {
    diagLog("NETWORK_OFFLINE", "Browser went offline");
  });

  window.addEventListener("online", () => {
    diagLog("NETWORK_ONLINE", "Browser came back online");
  });
}
