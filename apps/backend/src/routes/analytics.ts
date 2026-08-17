import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/auth";
import {
  recordPatternView,
  recordPatternLinkClick,
  recordSubscribeClick,
  recordSearchQuery,
} from "../controllers/analyticsController";
import { submitErrorReport } from "../controllers/reportController";

const router = Router();

// All analytics endpoints require an authenticated user (userId from JWT).
router.use(requireAuth);

router.post("/pattern-view", recordPatternView);
router.post("/pattern-link-click", recordPatternLinkClick);
router.post("/subscribe-click", recordSubscribeClick);
router.post("/search-query", recordSearchQuery);

// Screenshot attached to a "Report error" submission — kept in memory only,
// forwarded straight to Telegram's sendPhoto (reportController.ts) and
// never written to disk. Same limits as the Figma copy ("JPG/PNG, до 5MB").
const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("UNSUPPORTED_FORMAT"));
    }
    cb(null, true);
  },
});

router.post(
  "/report-error",
  (req, res, next) => {
    reportUpload.single("screenshot")(req, res, (err: any) => {
      if (err) {
        if (err.message === "UNSUPPORTED_FORMAT") {
          return res.status(400).json({ error: "Unsupported file format. Use jpeg or png." });
        }
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  submitErrorReport
);

export default router;
