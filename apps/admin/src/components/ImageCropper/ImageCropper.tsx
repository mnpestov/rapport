import React, { useState, useRef } from "react";
import { Button } from "../Button/Button";
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Upload } from "lucide-react";
import styles from "./ImageCropper.module.css";
import { uploadImage } from "../../api/patterns";
import toast from "react-hot-toast";

interface ImageCropperProps {
  onImageUploaded: (url: string) => void;
  currentUrl?: string;
  customButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  customButtonText?: string;
}

export function ImageCropper({ onImageUploaded, currentUrl, customButtonProps, customButtonText }: ImageCropperProps) {
  const [imgSrc, setImgSrc] = useState("");
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [isUploading, setIsUploading] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ASPECT = 4 / 5;

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setCrop(undefined);
      const reader = new FileReader();
      reader.addEventListener("load", () => setImgSrc(reader.result?.toString() || ""));
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (!naturalWidth || !naturalHeight) return;

    let widthPct;
    if (naturalWidth / naturalHeight > ASPECT) {
      // Image is wider than crop box. Height is the limiting factor.
      const cropHeightPx = naturalHeight * 0.9;
      const cropWidthPx = cropHeightPx * ASPECT;
      widthPct = (cropWidthPx / naturalWidth) * 100;
    } else {
      // Image is taller than crop box. Width is the limiting factor.
      widthPct = 90;
    }

    const heightPct = (widthPct * (naturalWidth / naturalHeight)) / ASPECT;

    setCrop({
      unit: "%",
      width: widthPct,
      height: heightPct,
      x: (100 - widthPct) / 2,
      y: (100 - heightPct) / 2
    });
  };

  const handleSave = async () => {
    if (!completedCrop || !imgRef.current) return;
    try {
      setIsUploading(true);

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Scale from rendered size back to natural (original) image pixels
      const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
      const scaleY = imgRef.current.naturalHeight / imgRef.current.height;

      // 4:5 crop at the "detail" tier's long side (1600px, see
      // image-pipeline.config.json) — this upload becomes the SOURCE that
      // Pattern/Draft writes later derive thumbnailUrl (and eventually a
      // resized detail variant) from server-side, so it needs to be at
      // least that large or those derivations would be capped below their
      // target by generateThumbnailUrl's never-upscale rule. Previously
      // 800×1000, which silently capped every admin-uploaded cover below
      // the detail target.
      const DETAIL_LONG_SIDE = 1600;
      canvas.width = DETAIL_LONG_SIDE * ASPECT;
      canvas.height = DETAIL_LONG_SIDE;

      ctx.drawImage(
        imgRef.current,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0, 0, canvas.width, canvas.height
      );

      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/webp", 0.9));
      if (!blob) throw new Error("Failed to create blob");

      const file = new File([blob], `cropped_${Date.now()}.webp`, { type: "image/webp" });
      const uploaded = await uploadImage(file);
      onImageUploaded(uploaded.url);
      setImgSrc("");
      setCrop(undefined);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success("Изображение успешно обрезано и загружено");
    } catch (err: any) {
      toast.error(err.message || "Ошибка загрузки");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    setImgSrc("");
    setCrop(undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className={styles.container}>
      {!imgSrc && (
        <button
          type="button"
          className={styles.uploadBtn}
          onClick={() => fileInputRef.current?.click()}
          {...customButtonProps}
        >
          {!customButtonProps && <Upload size={16} />}
          {customButtonText || "Выбрать изображение"}
        </button>
      )}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={onSelectFile}
      />

      {imgSrc && (
        <div className={styles.cropOverlay}>
          <p className={styles.cropTitle}>Выберите область (4:5)</p>

          <div className={styles.cropArea}>
            <ReactCrop
              crop={crop}
              onChange={(_, pct) => setCrop(pct)}
              onComplete={(c) => setCompletedCrop(c)}
              aspect={ASPECT}
              style={{ display: "inline-block", maxWidth: "100%", maxHeight: "380px" }}
            >
              <img
                ref={imgRef}
                alt="Crop"
                src={imgSrc}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "380px",
                  width: "auto",
                  height: "auto",
                  objectFit: "contain"
                }}
                onLoad={onImageLoad}
              />
            </ReactCrop>
          </div>

          <div className={styles.cropActions}>
            <Button variant="secondary" size="lg" onClick={handleCancel}>
              Отмена
            </Button>
            <Button
              size="lg"
              onClick={handleSave}
              disabled={isUploading || !completedCrop?.width}
            >
              {isUploading ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
