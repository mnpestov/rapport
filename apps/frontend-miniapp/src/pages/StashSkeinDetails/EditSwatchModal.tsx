import React, { useEffect, useRef, useState } from 'react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { updateStashSwatch, uploadStashImage, StashSwatch } from '../../api/stashApi';
import { API_URL } from '../../api/config';
import '../../styles/sheet.css';
import '../Stash/AddYarnModal.css';

const MAX_IMAGES = 5;

interface EditSwatchModalProps {
  isOpen: boolean;
  swatch: StashSwatch;
  onClose: () => void;
  onSaved: () => void;
}

// Та же вёрстка/CSS-классы, что у AddSwatchModal — по тому же принципу, что
// EditUsageModal переиспользует классы LogUsageWizard: кнопка
// "Редактировать" должна открывать визуально идентичную форму,
// предзаполненную текущими данными образца.
export const EditSwatchModal: React.FC<EditSwatchModalProps> = ({ isOpen, swatch, onClose, onSaved }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  const [needleSizeRaw, setNeedleSizeRaw] = useState('');
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
    setNeedleSizeRaw(swatch.needleSizeRaw || '');
    setStitchesBefore(swatch.densityStitchesBefore || '');
    setRowsBefore(swatch.densityRowsBefore || '');
    setStitchesAfter(swatch.densityStitchesAfter || '');
    setRowsAfter(swatch.densityRowsAfter || '');
    setImages(swatch.images.map((url) => (url.startsWith(API_URL) ? url.slice(API_URL.length) : url)));
    setError(null);
  }, [isOpen, swatch]);

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
      await updateStashSwatch(swatch.id, {
        images,
        needleSizeRaw: needleSizeRaw.trim() || undefined,
        densityStitchesBefore: stitchesBefore ? Number(stitchesBefore) : undefined,
        densityRowsBefore: rowsBefore ? Number(rowsBefore) : undefined,
        densityStitchesAfter: stitchesAfter ? Number(stitchesAfter) : undefined,
        densityRowsAfter: rowsAfter ? Number(rowsAfter) : undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить изменения');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div ref={sheetRef} className={`add-yarn-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="add-yarn-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="add-yarn-header">
          <h2 className="add-yarn-title">Редактировать образец</h2>
        </div>

        <div className="add-yarn-body">
          <div className="add-yarn-field">
            <label className="add-yarn-label">Размер спицы</label>
            <input className="add-yarn-input" value={needleSizeRaw} placeholder="Введите текст..." onChange={(e) => setNeedleSizeRaw(e.target.value)} />
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
                  <img src={url.startsWith('/') ? `${API_URL}${url}` : url} alt="" />
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
