import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import {
  updateStashSkein,
  suggestYarnFields,
  uploadStashImage,
  createStashSwatch,
  updateStashSwatch,
  deleteStashSwatch,
  StashSkeinDetail,
  StashSwatch,
} from '../../api/stashApi';
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

// Образец, уже существующий в БД (id реальный) или ещё не сохранённый
// (id === null, черновик — как SwatchDraft в AddYarnModal). Оба вида
// редактируются в одной и той же секции: разница только в том, какой
// API-вызов делает handleSave при сохранении (create vs update).
interface SwatchEntry {
  key: string;
  id: string | null;
  instrumentType: 'hook' | 'needle' | null;
  needleSizeRaw: string;
  strandsCount: string;
  stitchesBefore: string;
  rowsBefore: string;
  stitchesAfter: string;
  rowsAfter: string;
  note: string;
  images: string[];
  markedForDeletion: boolean;
}

function swatchToEntry(s: StashSwatch): SwatchEntry {
  return {
    key: s.id,
    id: s.id,
    instrumentType: s.instrumentType ?? null,
    needleSizeRaw: s.needleSizeRaw || '',
    strandsCount: s.strandsCount != null ? String(s.strandsCount) : '',
    stitchesBefore: s.densityStitchesBefore || '',
    rowsBefore: s.densityRowsBefore || '',
    stitchesAfter: s.densityStitchesAfter || '',
    rowsAfter: s.densityRowsAfter || '',
    note: s.note || '',
    images: s.images.map((url) => (url.startsWith(API_URL) ? url.slice(API_URL.length) : url)),
    markedForDeletion: false,
  };
}

function createEmptySwatchEntry(): SwatchEntry {
  return {
    key: `${Date.now()}-${Math.random()}`,
    id: null,
    instrumentType: null,
    needleSizeRaw: '',
    strandsCount: '',
    stitchesBefore: '',
    rowsBefore: '',
    stitchesAfter: '',
    rowsAfter: '',
    note: '',
    images: [],
    markedForDeletion: false,
  };
}

// Та же вёрстка/классы, что у AddYarnModal (создание нового мотка) — по
// требованию пользователя кнопка "Редактировать" должна открывать
// визуально идентичную форму, предзаполненную текущими данными, включая
// возможность править/добавлять/удалять образцы. Отличия от AddYarnModal
// осознанные, не пропуски:
// - Артикул/Бренд — это yarnNameSnapshot/brandSnapshot этого конкретного
//   мотка, не ссылка на справочный Yarn (yarnId не меняется и не может
//   смениться через эту форму) — правятся напрямую через updateStashSkein,
//   без заявки на модерацию: это не попытка исправить общий справочник, а
//   то, как пользователь сам подписывает свой моток у себя в хранилище.
// - Метраж/Состав всегда редактируемы — но, в отличие от Артикула/Бренда,
//   если введённое значение отличается от текущего снапшота, параллельно
//   уходит заявка на модерацию тем же suggestYarnFields (это сверка с
//   общим справочником Yarn, а не просто личная подпись мотка).
// - Образцы — уже существующие (skein.swatches) редактируются на месте
//   (PATCH) или помечаются на удаление (реальный DELETE — только по
//   Сохранить, не сразу по клику, чтобы можно было передумать до сабмита),
//   новые добавляются тем же способом, что в AddYarnModal (POST).
export const EditSkeinModal: React.FC<EditSkeinModalProps> = ({ isOpen, skein, onClose, onSaved }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  const [images, setImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const [yarnName, setYarnName] = useState('');
  const [brand, setBrand] = useState('');
  const [mPer100g, setMPer100g] = useState('');
  const [composition, setComposition] = useState('');
  const [colorName, setColorName] = useState('');
  const [dyelot, setDyelot] = useState('');
  const [totalWeightG, setTotalWeightG] = useState('');
  const [note, setNote] = useState('');

  const [swatches, setSwatches] = useState<SwatchEntry[]>([]);
  const [uploadingSwatchKey, setUploadingSwatchKey] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const swatchFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!isOpen) return;
    setImages(skein.images.map((url) => (url.startsWith(API_URL) ? url.slice(API_URL.length) : url)));
    setYarnName(skein.yarnNameSnapshot);
    setBrand(skein.brandSnapshot || '');
    setMPer100g(skein.mPer100gSnapshot != null ? String(skein.mPer100gSnapshot) : '');
    setComposition(skein.compositionSnapshot || '');
    setColorName(skein.colorName || '');
    setDyelot(skein.dyelot || '');
    setTotalWeightG(String(skein.totalWeightG));
    setNote(skein.note || '');
    setSwatches(skein.swatches.map(swatchToEntry));
    setError(null);
  }, [isOpen, skein]);

  if (!isMounted) return null;

  const handleAddPhotoClick = () => fileInputRef.current?.click();

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
      console.error('[EditSkeinModal] image upload failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
    } finally {
      setIsUploading(false);
    }
  };

  const removeImage = (url: string) => setImages((prev) => prev.filter((u) => u !== url));

  const updateSwatchEntry = (key: string, patch: Partial<SwatchEntry>) => {
    setSwatches((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const handleAddSwatch = () => setSwatches((prev) => [...prev, createEmptySwatchEntry()]);

  // Существующий образец — помечаем на удаление (реальный DELETE только по
  // Сохранить), черновик без id — убираем из списка сразу, ему нечего
  // удалять на сервере.
  const removeSwatch = (key: string) => {
    const entry = swatches.find((s) => s.key === key);
    if (!entry) return;
    if (entry.id) {
      updateSwatchEntry(key, { markedForDeletion: true });
    } else {
      setSwatches((prev) => prev.filter((s) => s.key !== key));
      delete swatchFileInputRefs.current[key];
    }
  };

  const restoreSwatch = (key: string) => updateSwatchEntry(key, { markedForDeletion: false });

  const handleSwatchFileSelected = (key: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploadingSwatchKey(key);
    try {
      for (const file of files) {
        let limitReached = false;
        setSwatches((prev) => {
          const swatch = prev.find((s) => s.key === key);
          if (!swatch || swatch.images.length >= MAX_IMAGES) { limitReached = true; return prev; }
          return prev;
        });
        if (limitReached) break;
        const url = await uploadStashImage(file);
        setSwatches((prev) => {
          const swatch = prev.find((s) => s.key === key);
          if (!swatch || swatch.images.length >= MAX_IMAGES) return prev;
          return prev.map((s) => s.key === key ? { ...s, images: [...s.images, url] } : s);
        });
      }
    } catch (err) {
      console.error('[EditSkeinModal] swatch image upload failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото образца');
    } finally {
      setUploadingSwatchKey(null);
    }
  };

  const removeSwatchImage = (key: string, url: string) => {
    const swatch = swatches.find((s) => s.key === key);
    if (!swatch) return;
    updateSwatchEntry(key, { images: swatch.images.filter((u) => u !== url) });
  };

  const isValid = yarnName.trim().length > 0 && totalWeightG.trim().length > 0 && Number(totalWeightG) > 0;

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
        yarnNameSnapshot: yarnName.trim(),
        // Пустая строка отправляется явно (не || undefined, как у
        // colorName/dyelot ниже) — иначе снять уже указанный бренд через
        // эту форму было бы нельзя: пустое значение молча не попало бы в
        // тело запроса, и бэкенд не тронул бы поле.
        brandSnapshot: brand.trim(),
        colorName: colorName.trim() || undefined,
        dyelot: dyelot.trim() || undefined,
        note: note.trim() || undefined,
        totalWeightG: weightValue,
      });

      // Та же логика, что в AddYarnModal — метраж/состав всегда редактируемы;
      // если введённое значение отличается от текущего снапшота (дозаполнение
      // пустого или исправление уже заполненного), отправляется отдельной
      // заявкой на модерацию (бэкенд обновляет snapshot этого мотка сразу).
      const typedMPer100g = mPer100g.trim() ? Number(mPer100g) : null;
      const typedComposition = composition.trim() || null;
      const suggestedMPer100g = typedMPer100g !== null && typedMPer100g !== skein.mPer100gSnapshot ? typedMPer100g : undefined;
      const suggestedComposition = typedComposition !== null && typedComposition !== (skein.compositionSnapshot || null) ? typedComposition : undefined;
      if (suggestedMPer100g !== undefined || suggestedComposition !== undefined) {
        try {
          await suggestYarnFields(skein.id, { mPer100g: suggestedMPer100g, composition: suggestedComposition });
        } catch (err) {
          // Остальные поля уже сохранены — не блокируем закрытие формы
          // из-за необязательной заявки на дозаполнение.
          console.error('[EditSkeinModal] suggestYarnFields failed:', err);
        }
      }

      for (const swatch of swatches) {
        try {
          if (swatch.markedForDeletion && swatch.id) {
            await deleteStashSwatch(swatch.id);
            continue;
          }
          const payload = {
            images: swatch.images,
            needleSizeRaw: swatch.needleSizeRaw.trim() || undefined,
            instrumentType: swatch.instrumentType ?? undefined,
            strandsCount: swatch.strandsCount ? Number(swatch.strandsCount) : undefined,
            densityStitchesBefore: swatch.stitchesBefore ? Number(swatch.stitchesBefore) : undefined,
            densityRowsBefore: swatch.rowsBefore ? Number(swatch.rowsBefore) : undefined,
            densityStitchesAfter: swatch.stitchesAfter ? Number(swatch.stitchesAfter) : undefined,
            densityRowsAfter: swatch.rowsAfter ? Number(swatch.rowsAfter) : undefined,
            note: swatch.note.trim() || undefined,
          };
          if (swatch.id) {
            await updateStashSwatch(swatch.id, payload);
          } else {
            const hasData =
              swatch.instrumentType || swatch.needleSizeRaw.trim() || swatch.strandsCount ||
              swatch.stitchesBefore || swatch.rowsBefore ||
              swatch.stitchesAfter || swatch.rowsAfter || swatch.note.trim() || swatch.images.length > 0;
            if (!hasData) continue;
            await createStashSwatch(skein.id, payload);
          }
        } catch (err) {
          // Остальные поля/образцы уже сохранены или пробуют сохраниться
          // независимо — один упавший образец не должен блокировать форму.
          console.error('[EditSkeinModal] swatch save failed:', err);
        }
      }

      onSaved();
    } catch (err) {
      console.error('[EditSkeinModal] handleSave failed:', err);
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
                multiple
                style={{ display: 'none' }}
                onChange={handleFileSelected}
              />
            </div>
          </div>

          <div className="add-yarn-section">
            <p className="add-yarn-section-title">Пряжа</p>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Артикул *</label>
              <input
                className="add-yarn-input"
                value={yarnName}
                placeholder="Введите текст..."
                onChange={(e) => setYarnName(e.target.value)}
              />
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Бренд</label>
              <input
                className="add-yarn-input"
                value={brand}
                placeholder="Введите текст..."
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Метраж (м/100г)</label>
              <input
                className="add-yarn-input"
                value={mPer100g}
                placeholder="Введите текст..."
                inputMode="numeric"
                onChange={(e) => setMPer100g(e.target.value)}
              />
              {skein.mPer100gSnapshot == null && (
                <p className="add-yarn-field-hint">
                  В справочнике это поле не заполнено — укажите значение, оно уйдёт на проверку модератору.
                </p>
              )}
              {skein.mPer100gSnapshot != null && (
                <p className="add-yarn-field-hint">
                  Если это значение отличается от справочника ({skein.mPer100gSnapshot} м/100г), исправление уйдёт на проверку модератору.
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
              />
              {!skein.compositionSnapshot && (
                <p className="add-yarn-field-hint">
                  В справочнике это поле не заполнено — укажите значение, оно уйдёт на проверку модератору.
                </p>
              )}
              {skein.compositionSnapshot && (
                <p className="add-yarn-field-hint">
                  Если это значение отличается от справочника ({skein.compositionSnapshot}), исправление уйдёт на проверку модератору.
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
            <p className="add-yarn-section-title">Образец</p>

            {swatches.map((swatch, index) => (
              <div key={swatch.key} className="add-yarn-swatch-draft">
                <div className="add-yarn-swatch-draft-header">
                  <span className="add-yarn-swatch-draft-title">
                    Образец {index + 1}{swatch.markedForDeletion ? ' (будет удалён)' : ''}
                  </span>
                  {swatch.markedForDeletion ? (
                    <button type="button" className="add-yarn-swatch-remove" onClick={() => restoreSwatch(swatch.key)}>
                      Отменить
                    </button>
                  ) : (
                    <button type="button" className="add-yarn-swatch-remove" onClick={() => removeSwatch(swatch.key)}>
                      Удалить
                    </button>
                  )}
                </div>

                {!swatch.markedForDeletion && (
                  <>
                    <div className="add-yarn-field">
                      <label className="add-yarn-label">Инструмент</label>
                      <div className="add-yarn-instrument-type-row">
                        <button
                          type="button"
                          className={`add-yarn-instrument-chip${swatch.instrumentType === 'needle' ? ' add-yarn-instrument-chip--active' : ''}`}
                          onClick={() => updateSwatchEntry(swatch.key, { instrumentType: swatch.instrumentType === 'needle' ? null : 'needle' })}
                        >
                          Спицы
                        </button>
                        <button
                          type="button"
                          className={`add-yarn-instrument-chip${swatch.instrumentType === 'hook' ? ' add-yarn-instrument-chip--active' : ''}`}
                          onClick={() => updateSwatchEntry(swatch.key, { instrumentType: swatch.instrumentType === 'hook' ? null : 'hook' })}
                        >
                          Крючок
                        </button>
                      </div>
                    </div>

                    {/* instrumentType || needleSizeRaw — образцы, созданные
                        до появления выбора инструмента, могут уже хранить
                        непустой needleSizeRaw при instrumentType=null;
                        гейтинг только на instrumentType скрыл бы это
                        старое значение от редактирования. */}
                    {(swatch.instrumentType || swatch.needleSizeRaw.trim()) && (
                      <div className="add-yarn-field">
                        <label className="add-yarn-label">Размер {swatch.instrumentType === 'needle' ? 'спиц' : swatch.instrumentType === 'hook' ? 'крючка' : 'инструмента'}</label>
                        <input
                          className="add-yarn-input"
                          value={swatch.needleSizeRaw}
                          placeholder="Например: 3.5"
                          inputMode="decimal"
                          onChange={(e) => updateSwatchEntry(swatch.key, { needleSizeRaw: e.target.value })}
                        />
                      </div>
                    )}

                    <div className="add-yarn-field">
                      <label className="add-yarn-label">Количество нитей</label>
                      <input
                        className="add-yarn-input"
                        value={swatch.strandsCount}
                        placeholder="Введите число..."
                        inputMode="numeric"
                        onChange={(e) => updateSwatchEntry(swatch.key, { strandsCount: e.target.value })}
                      />
                    </div>

                    <div className="add-yarn-field">
                      <label className="add-yarn-label">До ВТО</label>
                      <div className="add-yarn-density-row">
                        <div className="add-yarn-density-col">
                          <input className="add-yarn-input" value={swatch.stitchesBefore} placeholder="Петли" inputMode="decimal" onChange={(e) => updateSwatchEntry(swatch.key, { stitchesBefore: e.target.value })} />
                          <span className="add-yarn-density-sublabel">Петли</span>
                        </div>
                        <span className="add-yarn-density-x">х</span>
                        <div className="add-yarn-density-col">
                          <input className="add-yarn-input" value={swatch.rowsBefore} placeholder="Ряды" inputMode="decimal" onChange={(e) => updateSwatchEntry(swatch.key, { rowsBefore: e.target.value })} />
                          <span className="add-yarn-density-sublabel">Ряды</span>
                        </div>
                      </div>
                    </div>

                    <div className="add-yarn-field">
                      <label className="add-yarn-label">После ВТО</label>
                      <div className="add-yarn-density-row">
                        <div className="add-yarn-density-col">
                          <input className="add-yarn-input" value={swatch.stitchesAfter} placeholder="Петли" inputMode="decimal" onChange={(e) => updateSwatchEntry(swatch.key, { stitchesAfter: e.target.value })} />
                          <span className="add-yarn-density-sublabel">Петли</span>
                        </div>
                        <span className="add-yarn-density-x">х</span>
                        <div className="add-yarn-density-col">
                          <input className="add-yarn-input" value={swatch.rowsAfter} placeholder="Ряды" inputMode="decimal" onChange={(e) => updateSwatchEntry(swatch.key, { rowsAfter: e.target.value })} />
                          <span className="add-yarn-density-sublabel">Ряды</span>
                        </div>
                      </div>
                    </div>

                    <div className="add-yarn-field">
                      <label className="add-yarn-label">Заметка</label>
                      <textarea
                        className="add-yarn-textarea"
                        value={swatch.note}
                        placeholder="Любые наблюдения об образце..."
                        onChange={(e) => updateSwatchEntry(swatch.key, { note: e.target.value })}
                      />
                    </div>

                    <div className="add-yarn-field">
                      <label className="add-yarn-label">Фото образца</label>
                      <div className="add-yarn-photos">
                        {swatch.images.map((url) => (
                          <div key={url} className="add-yarn-photo-thumb">
                            <img src={url.startsWith('/') ? `${API_URL}${url}` : url} alt="" />
                            <button type="button" className="add-yarn-photo-remove" onClick={() => removeSwatchImage(swatch.key, url)}>×</button>
                          </div>
                        ))}
                        {swatch.images.length < MAX_IMAGES && (
                          <button
                            type="button"
                            className="add-yarn-photo-add"
                            onClick={() => swatchFileInputRefs.current[swatch.key]?.click()}
                            disabled={uploadingSwatchKey === swatch.key}
                          >
                            +
                          </button>
                        )}
                        <input
                          ref={(el) => { swatchFileInputRefs.current[swatch.key] = el; }}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          style={{ display: 'none' }}
                          onChange={handleSwatchFileSelected(swatch.key)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}

            <button type="button" className="add-yarn-category-chip" onClick={handleAddSwatch}>
              <Plus size={32} strokeWidth={1} className="add-yarn-category-chip-plus" />
              {swatches.length > 0 ? 'Добавить ещё образец' : 'Добавить образец'}
            </button>
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
