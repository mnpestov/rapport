import React, { useEffect, useRef, useState } from 'react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { updateStashSkein, uploadStashImage, StashSkeinDetail } from '../../api/stashApi';
import { API_URL } from '../../api/config';
import '../../styles/sheet.css';
import '../Stash/AddYarnModal.css';

const MAX_IMAGES = 5;

interface EditSkeinModalProps {
  isOpen: boolean;
  skein: StashSkeinDetail;
  onClose: () => void;
  onSaved: () => void;
}

// Правка полей, снятых напрямую с мотка (не со справочного артикула —
// yarnNameSnapshot/brandSnapshot/mPer100gSnapshot/compositionSnapshot не
// редактируются отсюда, для расхождений со справочником есть отдельная
// заявка на дозаполнение, см. stash-details-yarn-fix).
export const EditSkeinModal: React.FC<EditSkeinModalProps> = ({ isOpen, skein, onClose, onSaved }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  const [images, setImages] = useState<string[]>([]);
  const [colorName, setColorName] = useState('');
  const [dyelot, setDyelot] = useState('');
  const [note, setNote] = useState('');
  const [totalWeightG, setTotalWeightG] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setImages(skein.images.map((url) => (url.startsWith(API_URL) ? url.slice(API_URL.length) : url)));
    setColorName(skein.colorName || '');
    setDyelot(skein.dyelot || '');
    setNote(skein.note || '');
    setTotalWeightG(String(skein.totalWeightG));
    setError(null);
  }, [isOpen, skein]);

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
    const weightValue = Number(totalWeightG);
    if (!totalWeightG.trim() || !Number.isFinite(weightValue) || weightValue <= 0) {
      setError('Укажите корректный общий вес');
      return;
    }
    if (weightValue < skein.totalWeightG - skein.currentWeightG) {
      setError('Общий вес не может быть меньше уже списанного количества');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await updateStashSkein(skein.id, {
        images,
        colorName: colorName.trim() || undefined,
        dyelot: dyelot.trim() || undefined,
        note: note.trim() || undefined,
        totalWeightG: weightValue,
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
          <h2 className="add-yarn-title">Редактировать пряжу</h2>
        </div>

        <div className="add-yarn-body">
          <div className="add-yarn-section">
            <p className="add-yarn-section-title">Фото</p>
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

          <div className="add-yarn-field">
            <label className="add-yarn-label">Общий вес, г</label>
            <input
              className="add-yarn-input"
              value={totalWeightG}
              placeholder="Введите вес в граммах"
              inputMode="numeric"
              onChange={(e) => setTotalWeightG(e.target.value)}
            />
          </div>

          <div className="add-yarn-field">
            <label className="add-yarn-label">Цвет</label>
            <input className="add-yarn-input" value={colorName} placeholder="Введите цвет" onChange={(e) => setColorName(e.target.value)} />
          </div>

          <div className="add-yarn-field">
            <label className="add-yarn-label">Партия</label>
            <input className="add-yarn-input" value={dyelot} placeholder="Введите номер партии" onChange={(e) => setDyelot(e.target.value)} />
          </div>

          <div className="add-yarn-field">
            <label className="add-yarn-label">Заметка</label>
            <input className="add-yarn-input" value={note} placeholder="Введите заметку" onChange={(e) => setNote(e.target.value)} />
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
