import React, { useEffect, useRef, useState } from 'react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { createProjectSwatch, updateProjectSwatch, ProjectSwatch } from '../../api/projectsApi';
import { uploadStashImage } from '../../api/stashApi';
import { API_URL } from '../../api/config';
import '../../styles/sheet.css';
import '../Stash/AddYarnModal.css';

const MAX_IMAGES = 5;

interface ProjectSwatchModalProps {
  isOpen: boolean;
  projectId: string;
  // Отсутствует — форма создания; задан — форма редактирования, те же
  // классы вёрстки, что AddSwatchModal/EditSwatchModal используют для
  // StashSwatch, но свой API-путь (без связи со StashSwatch — образец
  // проекта существует независимо, см. PROJECTS_PLAN.md §4.2/§1.4).
  swatch?: ProjectSwatch;
  onClose: () => void;
  onSaved: (swatch: ProjectSwatch) => void;
}

export const ProjectSwatchModal: React.FC<ProjectSwatchModalProps> = ({ isOpen, projectId, swatch, onClose, onSaved }) => {
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
  const isEditing = !!swatch;

  useEffect(() => {
    if (!isOpen) return;
    setNeedleSizeRaw(swatch?.needleSizeRaw || '');
    setStrandsCount(swatch?.strandsCount != null ? String(swatch.strandsCount) : '');
    setStitchesBefore(swatch?.densityStitchesBefore || '');
    setRowsBefore(swatch?.densityRowsBefore || '');
    setStitchesAfter(swatch?.densityStitchesAfter || '');
    setRowsAfter(swatch?.densityRowsAfter || '');
    setImages((swatch?.images ?? []).map((url) => (url.startsWith(API_URL) ? url.slice(API_URL.length) : url)));
    setError(null);
  }, [isOpen, swatch]);

  if (!isMounted) return null;

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) return;
    const toUpload = files.slice(0, remainingSlots);
    setIsUploading(true);
    try {
      for (const file of toUpload) {
        const url = await uploadStashImage(file);
        setImages((prev) => [...prev, url]);
      }
    } catch (err) {
      console.error('[ProjectSwatchModal] image upload failed:', err);
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
      const payload = {
        images,
        needleSizeRaw: needleSizeRaw.trim() || undefined,
        strandsCount: strandsCount ? Number(strandsCount) : undefined,
        densityStitchesBefore: stitchesBefore ? Number(stitchesBefore) : undefined,
        densityRowsBefore: rowsBefore ? Number(rowsBefore) : undefined,
        densityStitchesAfter: stitchesAfter ? Number(stitchesAfter) : undefined,
        densityRowsAfter: rowsAfter ? Number(rowsAfter) : undefined,
      };
      const saved = isEditing
        ? await updateProjectSwatch(swatch!.id, payload)
        : await createProjectSwatch(projectId, payload);
      onSaved(saved);
    } catch (err) {
      console.error('[ProjectSwatchModal] handleSave failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось сохранить образец');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div ref={sheetRef} className={`add-yarn-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="add-yarn-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="add-yarn-header">
          <h2 className="add-yarn-title">{isEditing ? 'Редактировать образец' : 'Новый образец'}</h2>
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
                  <img src={url.startsWith('/') ? `${API_URL}${url}` : url} alt="" />
                  <button type="button" className="add-yarn-photo-remove" onClick={() => removeImage(url)}>×</button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <button type="button" className="add-yarn-photo-add" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                  +
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={handleFileSelected} />
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
