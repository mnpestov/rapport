import { useState } from "react";
import { X } from "lucide-react";
import { ImageCropper } from "../ImageCropper/ImageCropper";
import { API_URL } from "../../api/config";
import styles from "./ImageGalleryManager.module.css";

interface ImageGalleryManagerProps {
  images: string[];
  onChange: (images: string[]) => void;
  max?: number;
  disabled?: boolean;
}

function getImageUrl(url: string): string {
  if (url.startsWith("http")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

// First image is always the cover (Pattern.imageUrl is derived from
// images[0] server-side) — drag any tile to the first position to make it
// the cover, no separate "set as cover" action needed.
export function ImageGalleryManager({ images, onChange, max = 5, disabled = false }: ImageGalleryManagerProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleRemove = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
  };

  const handleAdd = (url: string) => {
    onChange([...images, url]);
  };

  const handleDrop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    const next = [...images];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    onChange(next);
    setDragIndex(null);
  };

  const canAddMore = images.length < max;

  return (
    <div className={styles.grid}>
      {images.map((url, index) => (
        <div
          key={`${url}-${index}`}
          className={styles.tile}
          draggable={!disabled}
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(index)}
          onDragEnd={() => setDragIndex(null)}
        >
          <img src={getImageUrl(url)} alt="" className={styles.thumb} />
          {index === 0 && <span className={styles.coverBadge}>Обложка</span>}
          {!disabled && (
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => handleRemove(index)}
              title="Удалить фото"
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}

      {!disabled && (
        <div className={styles.addTile}>
          {canAddMore ? (
            <ImageCropper
              onImageUploaded={handleAdd}
              customButtonText="+"
              customButtonProps={{ className: styles.addBtn }}
            />
          ) : (
            <div className={styles.addTileDisabled} title={`Не более ${max} фото`}>+</div>
          )}
        </div>
      )}

      <span className={styles.hint}>Перетащите фото, чтобы изменить порядок. Первое фото — обложка.</span>
    </div>
  );
}
