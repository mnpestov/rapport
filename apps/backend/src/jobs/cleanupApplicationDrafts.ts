import cron from "node-cron";
import { cleanupAbandonedApplicationDrafts } from "../controllers/authorApplicationController";

// Убирает брошенные черновики заявок на кабинет автора: черновик, который
// не менялся дольше суток, удаляется, и выбранный в нём логин снова
// свободен (self-serve логин автора).
//
// Single rapport-api instance (no pm2 cluster mode) — safe to schedule
// in-process without a distributed lock, как и остальные джобы.
export function startCleanupApplicationDraftsJob(): void {
  cleanupAbandonedApplicationDrafts().catch((err) =>
    console.error("[cleanupApplicationDrafts] initial run failed:", err)
  );

  // Каждый час.
  cron.schedule("0 * * * *", () => {
    cleanupAbandonedApplicationDrafts().catch((err) =>
      console.error("[cleanupApplicationDrafts] scheduled run failed:", err)
    );
  });
}
