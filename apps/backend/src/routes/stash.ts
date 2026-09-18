import { Router } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { loadOwnedSkein, loadOwnedSwatch, loadOwnedUsage } from "../middlewares/loadOwnedSkein";
import {
  listSkeins,
  createSkein,
  getSkein,
  updateSkein,
  deleteSkein,
  logUsage,
  undoUsage,
  createSwatch,
  updateSwatch,
  deleteSwatch,
  getMatches,
  suggestYarns,
  createStashYarn,
} from "../controllers/stashController";

const router = Router();

// Личное хранилище пряжи (YARN_STASH_PLAN.md) — целевая модель: доступно
// всем авторизованным пользователям бесплатно, с лимитом FREE_SKEIN_LIMIT
// артикулов и без подбора описаний (getMatches). PREMIUM_YARN_STASH (или
// ADMIN) снимает лимит и открывает подбор — гейтится точечно внутри
// createSkein/getMatches/logUsage.
//
// На период тестирования (до включения оплаты подписки) доступ к разделу
// целиком закрыт ролью ADMIN — requireAdmin ниже. Убрать эту строку, когда
// тестирование закончится, точечные PREMIUM_YARN_STASH-гейты внутри
// контроллеров уже готовы для фримиум-модели.
router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// Загрузка фото — своя директория uploads/yarn-stash/, не смешивается с
// uploads/patterns/ (T8, план §3.1). Зеркалит /admin/upload по форме
// (multer diskStorage + один и тот же набор допустимых MIME-типов/лимит
// размера), но пишет в другую папку и требует PREMIUM_YARN_STASH, а не
// AUTHOR_CABINET — тот гейт уже применён общим router.use() выше.
// ---------------------------------------------------------------------------
const stashStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, "../../uploads/yarn-stash"));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webp";
    cb(null, `${uuidv4()}${ext}`);
  },
});

const stashUpload = multer({
  storage: stashStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("UNSUPPORTED_FORMAT"));
    }
    cb(null, true);
  },
});

router.post(
  "/upload",
  (req, res, next) => {
    stashUpload.single("image")(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "UNSUPPORTED_FORMAT") {
          res.status(400).json({ error: "Unsupported file format. Use jpeg, png, or webp." });
          return;
        }
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  },
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    res.json({ url: `/uploads/yarn-stash/${req.file.filename}` });
  }
);

router.get("/skeins", listSkeins);
router.post("/skeins", createSkein);
router.get("/skeins/:id", loadOwnedSkein, getSkein);
router.patch("/skeins/:id", loadOwnedSkein, updateSkein);
router.delete("/skeins/:id", loadOwnedSkein, deleteSkein);

router.post("/skeins/:id/usage", loadOwnedSkein, logUsage);
router.delete("/usage/:id", loadOwnedUsage, undoUsage);

router.post("/skeins/:id/swatches", loadOwnedSkein, createSwatch);
router.patch("/swatches/:id", loadOwnedSwatch, updateSwatch);
router.delete("/swatches/:id", loadOwnedSwatch, deleteSwatch);

router.get("/skeins/:id/matches", loadOwnedSkein, getMatches);

router.get("/yarns/suggest", suggestYarns);
router.post("/yarns", createStashYarn);

export default router;
