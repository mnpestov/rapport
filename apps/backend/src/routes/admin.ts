import { Router } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { Permission } from "@prisma/client";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requirePermissionOrAdmin } from "../middlewares/requirePermission";
import { getPaywallStats, getPaywallStatsUsers } from "../controllers/paywallStatsController";
import { getPayments, checkPaymentStatus } from "../controllers/adminPaymentsController";
import {
  getUsersStats,
  getPatternsStats,
  getDashboard,
  getDashboardStats,
} from "../controllers/adminDashboardController";
import {
  getPatternsList,
  getPatternById,
  updatePattern,
  createPattern,
  deletePattern,
  resetAllIsNew,
  findPatternByUrl,
} from "../controllers/adminPatternsController";
import {
  getAuthors,
  createAuthor,
  updateAuthor,
  deleteAuthor,
} from "../controllers/adminAuthorsController";
import {
  getCategories,
  updateCategory,
  deleteCategory,
  getTags,
  updateTag,
  deleteTag,
  updateInstrument,
  deleteInstrument,
  getInstruments,
  getYarnRanges,
} from "../controllers/adminDictionariesController";
import {
  getDraftsList,
  getDraftById,
  approveDraft,
  rejectDraft,
  linkAuthor,
} from "../controllers/adminModerationController";
import {
  getPermissions,
  grantPermission,
  revokePermission,
} from "../controllers/adminPermissionsController";
import {
  getAuthorApplications,
  approveAuthorApplication,
  requestApplicationInfo,
  rejectAuthorApplication,
} from "../controllers/authorApplicationController";
import {
  grantAuthorCredentials,
  revokePassword,
  resendCredentials,
  revokeAccess,
} from "../controllers/authorCredentialController";
import {
  getPendingReports,
  getReportById,
  processSyncBatch,
  updateSyncItem,
  rejectSyncItem,
  getSyncStatus,
  checkPendingAuthors,
  startSync,
  startAuthorSync,
  clearSyncReport
} from "../controllers/syncController";
import {
  getWhitelist,
  createWhitelistEntry,
  updateWhitelistEntry,
  deleteWhitelistEntry,
  checkWhitelistSubscription,
  notifyWhitelistUser,
} from "../controllers/whitelistController";
import { getChatHistory, sendChatMessage, getChatFile, getUnreadMessages, markChatAsRead, getRequests } from "../controllers/chatController";
import { getUsers, getUserById, updateUser, getUserSubscription } from "../controllers/usersController";
import { getPriceCheckRuns, getPriceCheckStatus, triggerPriceCheck, getConfirmedAuthors } from "../controllers/priceCheckController";
import {
  listYarns,
  suggestYarns,
  listYarnBrands,
  listYarnLines,
  createYarn,
  updateYarn,
  deleteYarn,
  mergeYarn,
  approveYarn,
  rejectPendingYarn,
  getPatternYarns,
  setPatternYarns,
  resolveMention,
} from "../controllers/yarnsController";
import { getYarnStats } from "../controllers/yarnStatsController";

const router = Router();

const isDevBypass = process.env.DEV_BYPASS_ADMIN_AUTH === "true";
if (isDevBypass) {
  console.warn("⚠️ [Admin] DEV_BYPASS_ADMIN_AUTH is ENABLED. Auth is bypassed.");
}

// ---------------------------------------------------------------------------
// Image upload — accessible to admins AND author-cabinet users.
// Registered before the global requireAdmin middleware so that the
// requirePermissionOrAdmin check runs instead of requireAdmin for this route.
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, "../../uploads/patterns"));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webp";
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("UNSUPPORTED_FORMAT"));
    }
    cb(null, true);
  },
});

const uploadHandler = [
  requireAuth,
  requirePermissionOrAdmin(Permission.AUTHOR_CABINET),
  (req: any, res: any, next: any) => {
    upload.single("image")(req, res, (err: any) => {
      if (err) {
        if (err.message === "UNSUPPORTED_FORMAT") {
          return res.status(400).json({ error: "Unsupported file format. Use jpeg, png, or webp." });
        }
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  (req: any, res: any) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    res.json({ url: `/uploads/patterns/${req.file.filename}` });
  },
];

router.post("/upload", ...uploadHandler);

// ---------------------------------------------------------------------------
// Dictionary reads — accessible to admins AND author-cabinet users, since the
// shared create/edit pattern form (used by both admin and author cabinet)
// depends on them. Registered before the global requireAdmin middleware, same
// reasoning as the upload route above.
// ---------------------------------------------------------------------------
const dictReadHandler = [requireAuth, requirePermissionOrAdmin(Permission.AUTHOR_CABINET)];
router.get("/categories", ...dictReadHandler, getCategories);
router.get("/tags", ...dictReadHandler, getTags);
router.get("/instruments", ...dictReadHandler, getInstruments);
router.get("/yarn-ranges", ...dictReadHandler, getYarnRanges);
// Подсказка артикулов — здесь же и по той же причине: блок «Пряжа» живёт в
// общей форме описания, а её открывает и кабинет автора.
router.get("/yarns/suggest", ...dictReadHandler, suggestYarns);
// Autocomplete брендов и линеек — доступны и автору (кабинет), и админу.
// Зарегистрированы до requireAdmin по той же причине что и /yarns/suggest.
router.get("/yarns/brands", ...dictReadHandler, listYarnBrands);
router.get("/yarns/lines", ...dictReadHandler, listYarnLines);

// ---------------------------------------------------------------------------
// All remaining admin routes require an authenticated ADMIN user.
// ---------------------------------------------------------------------------
if (!isDevBypass) {
  router.use(requireAuth);
  router.use(requireAdmin);
}

router.get("/users/stats", getUsersStats);
router.get("/patterns/stats", getPatternsStats);
router.get("/dashboard", getDashboard);
router.get("/dashboard/stats", getDashboardStats);
router.get("/paywall-stats", getPaywallStats);
router.get("/paywall-stats/users", getPaywallStatsUsers);

// Счета: список всех платежей и ручная сверка конкретного счёта с
// Robokassa (см. adminPaymentsController).
router.get("/payments", getPayments);
router.post("/payments/:id/check", checkPaymentStatus);
router.get("/price-check-runs", getPriceCheckRuns);
router.get("/price-check-runs/status", getPriceCheckStatus);
router.get("/price-check-runs/confirmed-authors", getConfirmedAuthors);
router.post("/price-check-runs/trigger", triggerPriceCheck);

// ---------------------------------------------------------------------------
// Справочник артикулов пряжи и связи описаний с ним.
// «/yarns/suggest» зарегистрирован выше, до requireAdmin, — если объявить
// его здесь, до него не дойдёт очередь: «/yarns/:id» перехватит «suggest»
// как идентификатор.
// ---------------------------------------------------------------------------
router.get("/yarns", listYarns);
router.post("/yarns", createYarn);
router.patch("/yarns/:id", updateYarn);
router.delete("/yarns/:id", deleteYarn);
router.post("/yarns/:id/merge", mergeYarn);
router.patch("/yarns/:id/approve", approveYarn);
router.patch("/yarns/:id/reject", rejectPendingYarn);
router.get("/patterns/:id/yarns", getPatternYarns);
router.put("/patterns/:id/yarns", setPatternYarns);
router.post("/yarn-mentions/:id/resolve", resolveMention);
router.get("/yarn-stats", getYarnStats);

router.get("/patterns", getPatternsList);
// Static route before the /patterns/:id wildcard below — same reasoning as
// /yarns/suggest above (declared here, it'd be swallowed as :id="find-by-url").
router.get("/patterns/find-by-url", findPatternByUrl);
router.get("/patterns/:id", getPatternById);
router.post("/patterns/reset-new", resetAllIsNew);
router.post("/patterns", createPattern);
router.patch("/patterns/:id", updatePattern);
router.delete("/patterns/:id", deletePattern);

router.get("/authors", getAuthors);
router.post("/authors", createAuthor);
router.patch("/authors/:id", updateAuthor);
router.delete("/authors/:id", deleteAuthor);

router.patch("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);
router.patch("/tags/:id", updateTag);
router.delete("/tags/:id", deleteTag);
router.patch("/instruments/:id", updateInstrument);
router.delete("/instruments/:id", deleteInstrument);

router.get("/whitelist", getWhitelist);
router.post("/whitelist", createWhitelistEntry);
router.patch("/whitelist/:id", updateWhitelistEntry);
router.delete("/whitelist/:id", deleteWhitelistEntry);
router.post("/whitelist/:id/check-subscription", checkWhitelistSubscription);
router.post("/whitelist/:id/notify", notifyWhitelistUser);

// static routes before :telegramId wildcard
router.get("/chat/unread", getUnreadMessages);
router.get("/chat/file/:fileId", getChatFile);
router.get("/chat/:telegramId", getChatHistory);
router.post("/chat/:telegramId/send", sendChatMessage);
router.patch("/chat/:telegramId/read", markChatAsRead);

router.get("/requests", getRequests);

router.get("/users", getUsers);
router.get("/users/:telegramId/subscription", getUserSubscription);
router.post("/users/:id/link-author", linkAuthor);
router.get("/users/:id", getUserById);
router.patch("/users/:id", updateUser);

// Moderation queue
router.get("/drafts", getDraftsList);
router.get("/drafts/:id", getDraftById);
router.post("/drafts/:id/approve", approveDraft);
router.post("/drafts/:id/reject", rejectDraft);

// Permission management
router.get("/permissions", getPermissions);
router.post("/permissions", grantPermission);
router.delete("/permissions/:userId/:permission", revokePermission);

// Author Sync
router.get("/sync-reports", getPendingReports);
router.get("/sync-reports/:reportId", getReportById);
router.post("/sync-reports/:reportId/process-batch", processSyncBatch);
router.delete("/sync-reports/:reportId/clear", clearSyncReport);
router.patch("/sync-items/:itemId", updateSyncItem);
router.post("/sync-items/:itemId/reject", rejectSyncItem);
router.get("/sync-status", getSyncStatus);
router.get("/sync-pending", checkPendingAuthors);
router.post("/sync-start", startSync);
router.post("/authors/:id/sync-start", startAuthorSync);

// Author applications (login/password + applications feature)
router.get("/author-applications", getAuthorApplications);
router.post("/author-applications/:id/approve", approveAuthorApplication);
router.post("/author-applications/:id/needs-info", requestApplicationInfo);
router.post("/author-applications/:id/reject", rejectAuthorApplication);

// Author credentials — grant/revoke login+password access
router.post("/author-credentials", grantAuthorCredentials);
router.delete("/author-credentials/:userId", revokePassword);
router.post("/author-credentials/:userId/resend-credentials", resendCredentials);
router.post("/author-credentials/:userId/revoke-access", revokeAccess);

export default router;
