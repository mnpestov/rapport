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

type Variant = "thumb" | "detail";

function resolveDir(relativeUrl: string): { dir: string; prefix: string } {
  if (relativeUrl.startsWith("/uploads/patterns/")) {
    return { dir: UPLOADS_IMAGES_DIR, prefix: "/uploads/patterns/" };
  }
  return { dir: SCRAPER_IMAGES_DIR, prefix: "/images/patterns/" };
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
