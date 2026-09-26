import React, { useEffect, useRef, useState } from 'react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { createStashSwatch, updateStashSkein, uploadStashImage } from '../../api/stashApi';
import { API_URL } from '../../api/config';
import '../../styles/sheet.css';
import '../Stash/AddYarnModal.css';

const MAX_IMAGES = 5;

interface AddSwatchModalProps {
  isOpen: boolean;
  skeinId: string;
  existingSkeinImages: string[];
  onClose: () => void;
  onCreated: () => void;
}

export const AddSwatchModal: React.FC<AddSwatchModalProps> = ({ isOpen, skeinId, existingSkeinImages, onClose, onCreated }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  const [needleSizeRaw, setNeedleSizeRaw] = useState('');
  const [strandsCount, setStrandsCount] = useState('');
  const [stitchesBefore, setStitchesBefore] = useState('');
  const [rowsBefore, setRowsBefore] = useState('');
  const [stitchesAfter, setStitchesAfter] = useState('');
  const [rowsAfter, setRowsAfter] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setNeedleSizeRaw('');
    setStrandsCount('');
    setStitchesBefore('');
    setRowsBefore('');
    setStitchesAfter('');
    setRowsAfter('');
    setImages([]);
    setError(null);
  }, [isOpen]);

  if (!isMounted) return null;

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || images.length >= MAX_IMAGES) return;
    setIsUploading(true);
    try {
      const url = await uploadStashImage(file);
      setImages((prev) => [...prev, url]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
    } finally {
      setIsUploading(false);
    }
  };

  const removeImage = (url: string) => setImages((prev) => prev.filter((u) => u !== url));

  const handleSave = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await createStashSwatch(skeinId, {
        images,
        needleSizeRaw: needleSizeRaw.trim() || undefined,
        strandsCount: strandsCount ? Number(strandsCount) : undefined,
        densityStitchesBefore: stitchesBefore ? Number(stitchesBefore) : undefined,
        densityRowsBefore: rowsBefore ? Number(rowsBefore) : undefined,
        densityStitchesAfter: stitchesAfter ? Number(stitchesAfter) : undefined,
        densityRowsAfter: rowsAfter ? Number(rowsAfter) : undefined,
      });

      // Фото образца дублируются в общую галерею мотка — пользователь
      // ожидает видеть их на карточке пряжи, а не только внутри блока
      // "Образец". Дописываем к уже существующим фото (не перезаписываем),
      // относительными путями (API_URL склеен только для отображения).
      if (images.length > 0) {
        const relativeExisting = existingSkeinImages.map((url) =>
          url.startsWith(API_URL) ? url.slice(API_URL.length) : url
        );
        const combined = [...new Set([...relativeExisting, ...images])].slice(0, MAX_IMAGES);
        try {
          await updateStashSkein(skeinId, { images: combined });
        } catch {
          // Образец уже сохранён — не блокируем закрытие формы, если только
          // обновление галереи мотка не удалось.
        }
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить образец');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div ref={sheetRef} className={`add-yarn-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="add-yarn-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="add-yarn-header">
          <h2 className="add-yarn-title">Добавить образец</h2>
        </div>

        <div className="add-yarn-body">
          <div className="add-yarn-field">
            <label className="add-yarn-label">Размер спицы</label>
            <input className="add-yarn-input" value={needleSizeRaw} placeholder="Введите текст..." onChange={(e) => setNeedleSizeRaw(e.target.value)} />
          </div>

          <div className="add-yarn-field">
            <label className="add-yarn-label">Количество нитей</label>
            <input className="add-yarn-input" value={strandsCount} placeholder="Введите число..." inputMode="numeric" onChange={(e) => setStrandsCount(e.target.value)} />
          </div>

          <div className="add-yarn-field">
            <label className="add-yarn-label">До ВТО</label>
            <div className="add-yarn-density-row">
              <div className="add-yarn-density-col">
                <input className="add-yarn-input" value={stitchesBefore} placeholder="Петли" inputMode="decimal" onChange={(e) => setStitchesBefore(e.target.value)} />
                <span className="add-yarn-density-sublabel">Петли</span>
              </div>
              <span className="add-yarn-density-x">х</span>
              <div className="add-yarn-density-col">
                <input className="add-yarn-input" value={rowsBefore} placeholder="Ряды" inputMode="decimal" onChange={(e) => setRowsBefore(e.target.value)} />
                <span className="add-yarn-density-sublabel">Ряды</span>
              </div>
            </div>
          </div>

          <div className="add-yarn-field">
            <label className="add-yarn-label">После ВТО</label>
            <div className="add-yarn-density-row">
              <div className="add-yarn-density-col">
                <input className="add-yarn-input" value={stitchesAfter} placeholder="Петли" inputMode="decimal" onChange={(e) => setStitchesAfter(e.target.value)} />
                <span className="add-yarn-density-sublabel">Петли</span>
              </div>
              <span className="add-yarn-density-x">х</span>
              <div className="add-yarn-density-col">
                <input className="add-yarn-input" value={rowsAfter} placeholder="Ряды" inputMode="decimal" onChange={(e) => setRowsAfter(e.target.value)} />
                <span className="add-yarn-density-sublabel">Ряды</span>
              </div>
            </div>
          </div>

          <div className="add-yarn-section">
            <p className="add-yarn-section-title">Фото образца</p>
            <div className="add-yarn-photos">
              {images.map((url) => (
                <div key={url} className="add-yarn-photo-thumb">
                  <img src={url} alt="" />
                  <button type="button" className="add-yarn-photo-remove" onClick={() => removeImage(url)}>×</button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <button type="button" className="add-yarn-photo-add" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                  +
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleFileSelected} />
            </div>
          </div>

          {error && <p className="add-yarn-error">{error}</p>}
        </div>

        <div className="add-yarn-footer">
          <button type="button" className="btn add-yarn-close-btn" onClick={onClose} disabled={isSubmitting}>
            Закрыть
          </button>
          <button type="button" className="btn add-yarn-save-btn" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
};
