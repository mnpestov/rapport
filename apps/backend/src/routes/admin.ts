import { Router } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { Permission } from "@prisma/client";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requirePermissionOrAdmin } from "../middlewares/requirePermission";
import {
  getUsersStats,
  getPatternsStats,
  getDashboard,
  getDashboardStats,
  getPatternsList,
  getPatternById,
  updatePattern,
  createPattern,
  deletePattern,
  getAuthors,
  createAuthor,
  updateAuthor,
  deleteAuthor,
  resetAllIsNew,
  fixArchiveQuotes,
  getCategories,
  updateCategory,
  deleteCategory,
  getTags,
  updateTag,
  deleteTag,
  getInstruments,
  getYarnRanges,
  getDraftsList,
  getDraftById,
  approveDraft,
  rejectDraft,
  linkAuthor,
  getPermissions,
  grantPermission,
  revokePermission,
} from "../controllers/adminController";
import {
  getPendingReports,
  getReportById,
  processSyncBatch,
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

router.get("/patterns", getPatternsList);
router.get("/patterns/:id", getPatternById);
router.post("/patterns/reset-new", resetAllIsNew);
router.post("/patterns/fix-archive-quotes", fixArchiveQuotes);
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
router.post("/sync-items/:itemId/reject", rejectSyncItem);
router.get("/sync-status", getSyncStatus);
router.get("/sync-pending", checkPendingAuthors);
router.post("/sync-start", startSync);
router.post("/authors/:id/sync-start", startAuthorSync);

export default router;
