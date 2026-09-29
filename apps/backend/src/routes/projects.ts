import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { Permission } from "@prisma/client";
import { requireAuth } from "../middlewares/auth";
import { requirePermissionOrAdmin } from "../middlewares/requirePermission";
import { loadOwnedProject, loadOwnedProjectSwatch, loadOwnedProjectDocument } from "../middlewares/loadOwnedProject";
import { PROJECT_DOCUMENTS_DIR, MAX_PROJECT_DOCUMENT_SIZE_BYTES } from "../utils/projectDocuments";
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  completeProject,
  deleteProject,
  addProjectPattern,
  removeProjectPattern,
  addProjectYarn,
  removeProjectYarn,
  addProjectInstrument,
  removeProjectInstrument,
  createProjectSwatch,
  updateProjectSwatch,
  deleteProjectSwatch,
  uploadProjectDocument,
  getProjectDocumentFile,
  deleteProjectDocument,
  listDocumentHighlights,
  createDocumentHighlight,
  deleteDocumentHighlight,
  listDocumentDrawings,
  createDocumentDrawing,
  deleteDocumentDrawing,
} from "../controllers/projectsController";

const router = Router();

// Вязальные проекты (PROJECTS_PLAN.md) — доступ к разделу целиком гейтится
// отдельным Permission.PREMIUM_PROJECTS (выдаётся индивидуально из
// админки, см. Users.tsx), ADMIN проходит всегда без выдачи разрешения
// (requirePermissionOrAdmin). Раньше здесь был requireAdmin (ADMIN-only на
// период тестирования) — заменено на управляемый гейт по просьбе
// пользователя, PREMIUM_YARN_STASH внутри раздела по-прежнему отдельно
// снимает лимит FREE_PROJECT_LIMIT (§2.0 плана, не путать с этим гейтом).
router.use(requireAuth, requirePermissionOrAdmin(Permission.PREMIUM_PROJECTS));

router.get("/", listProjects);
router.post("/", createProject);
router.get("/:id", loadOwnedProject, getProject);
router.patch("/:id", loadOwnedProject, updateProject);
router.delete("/:id", loadOwnedProject, deleteProject);

router.post("/:id/complete", loadOwnedProject, completeProject);

router.post("/:id/patterns", loadOwnedProject, addProjectPattern);
router.delete("/:id/patterns/:patternId", loadOwnedProject, removeProjectPattern);

router.post("/:id/yarns", loadOwnedProject, addProjectYarn);
router.delete("/:id/yarns/:skeinId", loadOwnedProject, removeProjectYarn);

router.post("/:id/instruments", loadOwnedProject, addProjectInstrument);
router.delete("/:id/instruments/:instrumentId", loadOwnedProject, removeProjectInstrument);

router.post("/:id/swatches", loadOwnedProject, createProjectSwatch);
router.patch("/swatches/:id", loadOwnedProjectSwatch, updateProjectSwatch);
router.delete("/swatches/:id", loadOwnedProjectSwatch, deleteProjectSwatch);

// ─── PDF-описания (§8.1) ──────────────────────────────────────────────────
// Приватная директория (не uploads/, не примонтирована на express.static)
// — storedFileName генерируется как uuid+".pdf", не доверяем оригинальному
// имени как пути. Валидация MIME здесь (defense in depth), реальная
// проверка содержимого (сигнатура %PDF-) — в uploadProjectDocument.
const documentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PROJECT_DOCUMENTS_DIR),
  filename: (_req, _file, cb) => cb(null, `${uuidv4()}.pdf`),
});

const documentUpload = multer({
  storage: documentStorage,
  limits: { fileSize: MAX_PROJECT_DOCUMENT_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("UNSUPPORTED_FORMAT"));
    }
    cb(null, true);
  },
});

router.post(
  "/:id/documents",
  loadOwnedProject,
  (req, res, next) => {
    documentUpload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "UNSUPPORTED_FORMAT") {
          res.status(400).json({ error: "Unsupported file format. Only PDF is allowed." });
          return;
        }
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  },
  uploadProjectDocument
);
router.get("/documents/:id/file", loadOwnedProjectDocument, getProjectDocumentFile);
router.delete("/documents/:id", loadOwnedProjectDocument, deleteProjectDocument);

router.get("/documents/:id/highlights", loadOwnedProjectDocument, listDocumentHighlights);
router.post("/documents/:id/highlights", loadOwnedProjectDocument, createDocumentHighlight);
router.delete("/documents/highlights/:id", deleteDocumentHighlight);

router.get("/documents/:id/drawings", loadOwnedProjectDocument, listDocumentDrawings);
router.post("/documents/:id/drawings", loadOwnedProjectDocument, createDocumentDrawing);
router.delete("/documents/drawings/:id", deleteDocumentDrawing);

export default router;
