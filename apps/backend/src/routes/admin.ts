import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/requireAdmin";
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
} from "../controllers/adminController";

const router = Router();

const isDevBypass = process.env.DEV_BYPASS_ADMIN_AUTH === "true";

if (!isDevBypass) {
  // Every admin route requires an authenticated ADMIN user.
  router.use(requireAuth);
  router.use(requireAdmin);
} else {
  console.warn("⚠️ [Admin] DEV_BYPASS_ADMIN_AUTH is ENABLED. Auth is bypassed.");
}

import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// Настройка Multer для сохранения в uploads/patterns
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../../uploads/patterns"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webp";
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("UNSUPPORTED_FORMAT"));
    }
    cb(null, true);
  },
});

router.get("/users/stats", getUsersStats);
router.get("/patterns/stats", getPatternsStats);
router.get("/dashboard", getDashboard);
router.get("/dashboard/stats", getDashboardStats);

router.get("/patterns", getPatternsList);
router.get("/patterns/:id", getPatternById);
router.post("/patterns", createPattern);
router.patch("/patterns/:id", updatePattern);
router.delete("/patterns/:id", deletePattern);

router.post("/upload", (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      if (err.message === "UNSUPPORTED_FORMAT") {
        return res.status(400).json({ error: "Unsupported file format. Use jpeg, png, or webp." });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const imageUrl = `/uploads/patterns/${req.file.filename}`;
  res.json({ url: imageUrl });
});

router.get("/authors", getAuthors);
router.post("/authors", createAuthor);
router.patch("/authors/:id", updateAuthor);
router.delete("/authors/:id", deleteAuthor);

import { getCategories, getTags, getInstruments } from "../controllers/adminController";

router.get("/categories", getCategories);
router.get("/tags", getTags);
router.get("/instruments", getInstruments);

export default router;
