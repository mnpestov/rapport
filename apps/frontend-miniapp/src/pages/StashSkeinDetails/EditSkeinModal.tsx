import React, { useEffect, useRef, useState } from 'react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { updateStashSkein, suggestYarnFields, uploadStashImage, StashSkeinDetail } from '../../api/stashApi';
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

// Та же вёрстка/классы, что у AddYarnModal (создание нового мотка) — по
// требованию пользователя кнопка "Редактировать" должна открывать
// визуально идентичную форму, предзаполненную текущими данными. Отличия
// от AddYarnModal осознанные, не пропуски:
// - Название/Бренд всегда read-only — артикул (yarnId) мотка неизменен,
//   смена артикула означала бы фактически другую пряжу, не правку записи.
// - Метраж/Состав редактируемы, только если снапшот ещё пуст — та же
//   логика дозаполнения, что при создании (см. AddYarnModal), при
//   заполнении уходит заявка на модерацию тем же suggestYarnFields.
// - Без блока "Образец" — образцы уже редактируются отдельно со страницы
//   карточки (AddSwatchModal), дублировать здесь незачем.
export const EditSkeinModal: React.FC<EditSkeinModalProps> = ({ isOpen, skein, onClose, onSaved }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  const [images, setImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const [mPer100g, setMPer100g] = useState('');
  const [composition, setComposition] = useState('');
  const [colorName, setColorName] = useState('');
  const [dyelot, setDyelot] = useState('');
  const [totalWeightG, setTotalWeightG] = useState('');
  const [note, setNote] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setImages(skein.images.map((url) => (url.startsWith(API_URL) ? url.slice(API_URL.length) : url)));
    setMPer100g(skein.mPer100gSnapshot != null ? String(skein.mPer100gSnapshot) : '');
    setComposition(skein.compositionSnapshot || '');
    setColorName(skein.colorName || '');
    setDyelot(skein.dyelot || '');
    setTotalWeightG(String(skein.totalWeightG));
    setNote(skein.note || '');
    setError(null);
  }, [isOpen, skein]);

  if (!isMounted) return null;

  const handleAddPhotoClick = () => fileInputRef.current?.click();

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

  const isValid = totalWeightG.trim().length > 0 && Number(totalWeightG) > 0;

  const handleSave = async () => {
    if (!isValid || isSubmitting) return;
    const weightValue = Number(totalWeightG);
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

      // Та же логика дозаполнения, что в AddYarnModal — метраж/состав
      // редактируемы, только пока снапшот пуст, отправляются отдельной
      // заявкой на модерацию (бэкенд обновляет snapshot этого мотка сразу).
      const suggestedMPer100g = skein.mPer100gSnapshot == null && mPer100g.trim() ? Number(mPer100g) : undefined;
      const suggestedComposition = !skein.compositionSnapshot && composition.trim() ? composition.trim() : undefined;
      if (suggestedMPer100g !== undefined || suggestedComposition !== undefined) {
        try {
          await suggestYarnFields(skein.id, { mPer100g: suggestedMPer100g, composition: suggestedComposition });
        } catch {
          // Остальные поля уже сохранены — не блокируем закрытие формы
          // из-за необязательной заявки на дозаполнение.
        }
      }

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
                <button type="button" className="add-yarn-photo-add" onClick={handleAddPhotoClick} disabled={isUploading}>
                  +
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handleFileSelected}
              />
            </div>
          </div>

          <div className="add-yarn-section">
            <p className="add-yarn-section-title">Пряжа</p>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Название</label>
              <input className="add-yarn-input" value={skein.yarnNameSnapshot} disabled />
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Бренд</label>
              <input className="add-yarn-input" value={skein.brandSnapshot || ''} placeholder="—" disabled />
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Метраж</label>
              <input
                className="add-yarn-input"
                value={mPer100g}
                placeholder="Введите текст..."
                inputMode="numeric"
                onChange={(e) => setMPer100g(e.target.value)}
                disabled={skein.mPer100gSnapshot != null}
              />
              {skein.mPer100gSnapshot == null && (
                <p className="add-yarn-field-hint">
                  В справочнике это поле не заполнено — укажите значение, оно уйдёт на проверку модератору.
                </p>
              )}
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Состав</label>
              <input
                className="add-yarn-input"
                value={composition}
                placeholder="Введите текст..."
                onChange={(e) => setComposition(e.target.value)}
                disabled={!!skein.compositionSnapshot}
              />
              {!skein.compositionSnapshot && (
                <p className="add-yarn-field-hint">
                  В справочнике это поле не заполнено — укажите значение, оно уйдёт на проверку модератору.
                </p>
              )}
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Цвет</label>
              <input className="add-yarn-input" value={colorName} placeholder="Введите текст..." onChange={(e) => setColorName(e.target.value)} />
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Партия</label>
              <input className="add-yarn-input" value={dyelot} placeholder="Введите текст..." onChange={(e) => setDyelot(e.target.value)} />
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Общий вес*</label>
              <input
                className="add-yarn-input"
                value={totalWeightG}
                placeholder="Вес в граммах"
                inputMode="numeric"
                onChange={(e) => setTotalWeightG(e.target.value)}
              />
            </div>
          </div>

          <div className="add-yarn-section">
            <p className="add-yarn-section-title">Заметки</p>
            <textarea
              className="add-yarn-textarea"
              value={note}
              placeholder="Здесь можно писать всё, что душе угодно"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && <p className="add-yarn-error">{error}</p>}
        </div>

        <div className="add-yarn-footer">
          <button type="button" className="btn add-yarn-close-btn" onClick={onClose} disabled={isSubmitting}>
            Закрыть
          </button>
          <button
            type="button"
            className="btn add-yarn-save-btn"
            onClick={handleSave}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
};
