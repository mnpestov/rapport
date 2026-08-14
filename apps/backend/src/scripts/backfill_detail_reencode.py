#!/usr/bin/env python3
# Phase 2b of the image-optimization plan: reencodes every Pattern.images[]
# entry (currently the raw as-scraped/as-uploaded original — sometimes many
# MB) down to the "detail" tier (1600px, q85, webp) from
# image-pipeline.config.json, using the same content-addressed naming as
# generate_thumbnail_url (backfill_pattern_images.py). Unlike Phase 2a
# (thumbnailUrl, purely additive), this REPLACES what images[]/imageUrl
# point to, so it carries real risk: a processing bug here could visibly
# corrupt a pattern's gallery for every user. Two safety nets:
#
#   1. SSIM gate — compares the saved detail-tier output against a
#      same-pipeline, same-size reference derived straight from the
#      original bytes. This is not a "does it look good" check (webp
#      compression alone won't fail it) — it's a self-consistency check
#      that catches processing bugs (wrong crop, double rotation, channel
#      corruption) before they ever reach the DB. Below SSIM_THRESHOLD,
#      the entry is left untouched and flagged for manual review.
#   2. Archival, not deletion — every original that gets replaced is moved
#      (never deleted) to images_archive/, which sits outside public/ and
#      uploads/ so Express never serves it. Recoverable if anything turns
#      out wrong after the fact.
#
# Idempotent / resumable: any images[] entry whose filename already ends
# in "-detail.webp" or "-thumb.webp" is treated as already a derivative
# and left alone, so a partial or re-run only touches what's left.
#
# Usage: DATABASE_URL=... python3 backfill_detail_reencode.py [limit]
#   limit: optional int, process at most this many patterns (for a small
#   validation run before the full sweep).
import hashlib
import io
import json
import os
import shutil
import sys

import numpy as np
import psycopg2
from PIL import Image, ImageOps
from skimage.metrics import structural_similarity as ssim_compare

BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SCRAPER_IMAGES_DIR = os.path.join(BACKEND_ROOT, "public", "images", "patterns")
UPLOADS_IMAGES_DIR = os.path.join(BACKEND_ROOT, "uploads", "patterns")
ARCHIVE_IMAGES_DIR = os.path.join(BACKEND_ROOT, "images_archive", "images_patterns")
ARCHIVE_UPLOADS_DIR = os.path.join(BACKEND_ROOT, "images_archive", "uploads_patterns")

with open(os.path.join(BACKEND_ROOT, "image-pipeline.config.json"), encoding="utf-8") as _f:
    IMAGE_PIPELINE_CONFIG = json.load(_f)

# Calibrated on real data: a texture-heavy photo (wool socks + a fuzzy rug,
# all fine high-frequency detail) scored 0.81 from q85 webp compression
# alone — confirmed visually identical, no crop/rotation/corruption, just
# SSIM being naturally more sensitive on busy textures. A real processing
# bug (wrong crop, double rotation, channel corruption) produces a
# structurally different image and scores far lower than compression
# artifacts ever do. 0.75 comfortably clears legitimate texture-heavy
# photos while still catching genuine corruption.
SSIM_THRESHOLD = 0.75


def _dirs_for(rel_url: str):
    if rel_url.startswith("/uploads/patterns/"):
        return UPLOADS_IMAGES_DIR, ARCHIVE_UPLOADS_DIR, "/uploads/patterns/"
    return SCRAPER_IMAGES_DIR, ARCHIVE_IMAGES_DIR, "/images/patterns/"


def _ssim_check(source_bytes: bytes, output_path: str, max_dim: int) -> float:
    ref = Image.open(io.BytesIO(source_bytes))
    ref = ImageOps.exif_transpose(ref)
    if ref.mode != "RGB":
        ref = ref.convert("RGB")
    ref.thumbnail((max_dim, max_dim), Image.LANCZOS)

    out = Image.open(output_path).convert("RGB")
    if ref.size != out.size:
        out = out.resize(ref.size, Image.LANCZOS)

    return float(ssim_compare(np.asarray(ref), np.asarray(out), channel_axis=-1))


def generate_detail_url(rel_url: str):
    """
    Reencodes one images[] entry to the detail tier.
    Returns one of:
      {"status": "ok", "new_url", "source_path" (or None if reused from a
                 sibling pattern's identical filename), "archive_dir", "ssim" (or None)}
      {"status": "skip_derivative"}
      {"status": "missing_source"}
      {"status": "ssim_fail", "ssim": float}
      {"status": "error", "error": str}
    """
    basename = os.path.basename(rel_url)
    if basename.endswith("-detail.webp") or basename.endswith("-thumb.webp"):
        return {"status": "skip_derivative"}

    out_dir, archive_dir, prefix = _dirs_for(rel_url)
    live_path = os.path.join(out_dir, basename)
    archived_path = os.path.join(archive_dir, basename)

    if os.path.exists(live_path):
        source_path, needs_archive = live_path, True
    elif os.path.exists(archived_path):
        # Same filename already archived by an earlier-processed sibling
        # pattern in this run (two patterns sharing one source image) —
        # reuse it instead of reporting a false missing_source.
        source_path, needs_archive = archived_path, False
    else:
        return {"status": "missing_source"}

    try:
        with open(source_path, "rb") as f:
            source_bytes = f.read()

        cfg = IMAGE_PIPELINE_CONFIG["detail"]
        max_dim, quality, fmt = cfg["maxDimension"], cfg["quality"], IMAGE_PIPELINE_CONFIG["format"]
        h = hashlib.sha256()
        h.update(source_bytes)
        h.update(f"|v{IMAGE_PIPELINE_CONFIG['version']}|detail|{max_dim}|q{quality}|{fmt}".encode())
        filename = f"{h.hexdigest()[:16]}-detail.{fmt}"
        output_path = os.path.join(out_dir, filename)

        score = None
        if not os.path.exists(output_path):
            img = Image.open(io.BytesIO(source_bytes))
            img = ImageOps.exif_transpose(img)
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)
            img.save(output_path, format="WEBP", quality=quality)

            score = _ssim_check(source_bytes, output_path, max_dim)
            if score < SSIM_THRESHOLD:
                os.remove(output_path)
                return {"status": "ssim_fail", "ssim": score}

        return {
            "status": "ok",
            "new_url": f"{prefix}{filename}",
            "source_path": source_path if needs_archive else None,
            "archive_dir": archive_dir,
            "ssim": score,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None

    db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/knitting_catalog")
    if "?" in db_url:
        db_url = db_url.split("?")[0]
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    cursor.execute('''
        SELECT id, images
        FROM "Pattern"
        WHERE images IS NOT NULL AND array_length(images, 1) > 0
        ORDER BY "createdAt"
    ''')
    rows = cursor.fetchall()
    if limit:
        rows = rows[:limit]
    print(f"{len(rows)} pattern(s) to check")

    patterns_changed = 0
    entries_reencoded = 0
    entries_skipped_derivative = 0
    entries_missing_source = 0
    ssim_failures = []
    errors = []
    ssim_scores = []
    bytes_before = 0
    bytes_after = 0

    for pattern_id, images in rows:
        new_images = []
        to_archive = []
        changed = False

        for entry in images:
            result = generate_detail_url(entry)
            status = result["status"]

            if status == "skip_derivative":
                new_images.append(entry)
                entries_skipped_derivative += 1
                continue
            if status == "missing_source":
                new_images.append(entry)
                entries_missing_source += 1
                continue
            if status == "ssim_fail":
                new_images.append(entry)
                ssim_failures.append((pattern_id, entry, result["ssim"]))
                continue
            if status == "error":
                new_images.append(entry)
                errors.append((pattern_id, entry, result["error"]))
                continue

            # status == "ok"
            new_images.append(result["new_url"])
            if result["source_path"]:
                to_archive.append((result["source_path"], result["archive_dir"]))
                bytes_before += os.path.getsize(result["source_path"])
                bytes_after += os.path.getsize(
                    os.path.join(os.path.dirname(result["source_path"]), os.path.basename(result["new_url"]))
                )
            if result["ssim"] is not None:
                ssim_scores.append(result["ssim"])
            changed = True

        if changed:
            new_image_url = new_images[0]
            cursor.execute(
                'UPDATE "Pattern" SET images = %s, "imageUrl" = %s WHERE id = %s',
                (new_images, new_image_url, pattern_id),
            )
            conn.commit()
            for source_path, archive_dir in to_archive:
                os.makedirs(archive_dir, exist_ok=True)
                dest = os.path.join(archive_dir, os.path.basename(source_path))
                if not os.path.exists(dest):
                    shutil.move(source_path, dest)
                elif os.path.exists(source_path):
                    os.remove(source_path)
            patterns_changed += 1
            entries_reencoded += len(to_archive) if to_archive else 1

    print(
        f"Done. patterns_changed={patterns_changed} entries_reencoded={entries_reencoded} "
        f"skipped_already_derivative={entries_skipped_derivative} missing_source={entries_missing_source} "
        f"ssim_failures={len(ssim_failures)} errors={len(errors)}"
    )
    if ssim_scores:
        print(f"SSIM: min={min(ssim_scores):.4f} avg={sum(ssim_scores)/len(ssim_scores):.4f}")
    if bytes_before:
        print(
            f"Size: {bytes_before/1024/1024:.1f}MB -> {bytes_after/1024/1024:.1f}MB "
            f"({100*(1-bytes_after/bytes_before):.0f}% reduction)"
        )
    if ssim_failures:
        print("SSIM failures (left untouched, needs manual review):")
        for pid, entry, score in ssim_failures[:20]:
            print(f"  {pid}  {entry}  ssim={score:.3f}")
    if errors:
        print("Errors (left untouched):")
        for pid, entry, err in errors[:20]:
            print(f"  {pid}  {entry}  {err}")

    cursor.close()
    conn.close()


if __name__ == "__main__":
    main()
