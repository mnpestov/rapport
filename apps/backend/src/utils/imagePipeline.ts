import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";

// Single source of truth for resize/quality/format — also read by the
// Python backfill script (author_sync_lib) so the two ingestion paths
// can't drift apart. See image-pipeline.config.json for the actual values.
const CONFIG_PATH = path.join(__dirname, "../../image-pipeline.config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as {
  version: number;
  thumb: { maxDimension: number; quality: number };
  detail: { maxDimension: number; quality: number };
  format: string;
};

const SCRAPER_IMAGES_DIR = path.join(__dirname, "../../public/images/patterns");
const UPLOADS_IMAGES_DIR = path.join(__dirname, "../../uploads/patterns");
// Хранилище пряжи (YARN_STASH_PLAN.md T8) — своя директория, не смешивается
// с фото описаний. Явная третья ветка ниже, а не тихий fallback в
// SCRAPER_IMAGES_DIR: план прямо предупреждает, что копипаста без явного
// отказа для неизвестных префиксов молча промахивает файлы мимо своей
// директории (existsSync просто вернёт false, thumbnail не сгенерируется —
// деградация без единой ошибки в логах).
const YARN_STASH_IMAGES_DIR = path.join(__dirname, "../../uploads/yarn-stash");

type Variant = "thumb" | "detail";

function resolveDir(relativeUrl: string): { dir: string; prefix: string } {
  if (relativeUrl.startsWith("/uploads/patterns/")) {
    return { dir: UPLOADS_IMAGES_DIR, prefix: "/uploads/patterns/" };
  }
  if (relativeUrl.startsWith("/uploads/yarn-stash/")) {
    return { dir: YARN_STASH_IMAGES_DIR, prefix: "/uploads/yarn-stash/" };
  }
  if (relativeUrl.startsWith("/images/patterns/")) {
    return { dir: SCRAPER_IMAGES_DIR, prefix: "/images/patterns/" };
  }
  // Неизвестный префикс — явная ошибка, а не молчаливый fallback в
  // SCRAPER_IMAGES_DIR (см. комментарий выше и YARN_STASH_PLAN.md §3.1).
  throw new Error(`[imagePipeline] Unknown image URL prefix, cannot resolve directory: ${relativeUrl}`);
}

// Generates (or reuses, if already generated) a resized derivative of
// `sourceRelativeUrl` in the same directory the source lives in.
//
// Content-addressed filename — sha256(source bytes + version + variant +
// params) — so changing image-pipeline.config.json automatically produces
// new filenames instead of silently overwriting a file already being
// served under a long-lived immutable Cache-Control (see index.ts); an
// unchanged source+params combination resolves to the same filename and
// skips regenerating it (existsSync check below), so calling this
// repeatedly on an unchanged cover is cheap.
//
// Never upscales (`withoutEnlargement`) and normalizes EXIF orientation
// before resizing (`.rotate()` with no args) — see
// PATTERN_IMAGES_BACKFILL_PROCESS.md / image_pipeline review notes for why
// both are required, not optional.
//
// Resilient by design: returns null (never throws) on any failure — source
// file missing, corrupt image, sharp error — since this is a derived,
// best-effort field. Callers fall back to imageUrl when null.
async function generateVariantUrl(sourceRelativeUrl: string, variant: Variant): Promise<string | null> {
  try {
    const { dir, prefix } = resolveDir(sourceRelativeUrl);
    const sourcePath = path.join(dir, path.basename(sourceRelativeUrl));
    if (!fs.existsSync(sourcePath)) {
      return null;
    }

    const sourceBytes = fs.readFileSync(sourcePath);
    const { maxDimension, quality } = config[variant];
    const hash = crypto
      .createHash("sha256")
      .update(sourceBytes)
      .update(`|v${config.version}|${variant}|${maxDimension}|q${quality}|${config.format}`)
      .digest("hex")
      .slice(0, 16);
    const filename = `${hash}-${variant}.${config.format}`;
    const outputPath = path.join(dir, filename);

    if (!fs.existsSync(outputPath)) {
      await sharp(sourceBytes)
        .rotate()
        .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toFile(outputPath);
    }

    return `${prefix}${filename}`;
  } catch (error) {
    console.error(`[imagePipeline] Failed to generate ${variant} for ${sourceRelativeUrl}:`, error);
    return null;
  }
}

export const generateThumbnailUrl = (sourceRelativeUrl: string): Promise<string | null> =>
  generateVariantUrl(sourceRelativeUrl, "thumb");

export const generateDetailUrl = (sourceRelativeUrl: string): Promise<string | null> =>
  generateVariantUrl(sourceRelativeUrl, "detail");

// Приводит только что загруженный оригинал (admin/upload, кабинет автора и
// VK-импорт) к тому же пределу, что и detail-вариант (см. config.detail) —
// раньше оригинал сохранялся как есть, любого размера/веса/формата, и
// именно ЕГО (не thumbnail/detail) видит пользователь без подписки на
// странице описания (imageUrl остаётся полноразмерным по контракту, см.
// Pattern.imageUrl в schema.prisma). В отличие от generateVariantUrl —
// перезаписывает исходный файл на диске под НОВЫМ именем (не производная
// рядом со старой), исходный временный файл удаляет вызывающая сторона.
//
// Как и остальной pipeline: .rotate() без аргументов нормализует EXIF-
// поворот, withoutEnlargement не апскейлит уже маленькие изображения.
export async function normalizeUploadedImage(sourcePath: string, destDir: string): Promise<string> {
  const { maxDimension, quality } = config.detail;
  const filename = `${crypto.randomUUID()}.${config.format}`;
  const outputPath = path.join(destDir, filename);
  await sharp(sourcePath)
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toFile(outputPath);
  return filename;
}
