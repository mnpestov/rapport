import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import {
  createStashSkein,
  createStashSwatch,
  suggestStashYarns,
  importRavelryYarn,
  suggestYarnFields,
  uploadStashImage,
  StashLimitReachedError,
  StashSkein,
  YarnSuggestion,
} from '../../api/stashApi';
import '../../styles/sheet.css';
import './AddYarnModal.css';

const MAX_IMAGES = 5;

interface SwatchDraft {
  key: string;
  needleSizeRaw: string;
  stitchesBefore: string;
  rowsBefore: string;
  stitchesAfter: string;
  rowsAfter: string;
  images: string[];
}

function createEmptySwatchDraft(): SwatchDraft {
  return {
    key: `${Date.now()}-${Math.random()}`,
    needleSizeRaw: '',
    stitchesBefore: '',
    rowsBefore: '',
    stitchesAfter: '',
    rowsAfter: '',
    images: [],
  };
}

interface AddYarnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (skein: StashSkein) => void;
  // Гонка: пользователь открыл форму до того, как счётчик лимита обновился
  // (или открыл в другой вкладке) — сервер всё равно проверяет лимит сам
  // (createSkein), это обработчик именно этого случая, а не замена клиентской
  // проверки перед открытием формы (та уже сделана в Stash.tsx).
  onLimitReached: () => void;
}

export const AddYarnModal: React.FC<AddYarnModalProps> = ({ isOpen, onClose, onCreated, onLimitReached }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  const [images, setImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const [nameQuery, setNameQuery] = useState('');
  const [suggestions, setSuggestions] = useState<YarnSuggestion[]>([]);
  const [selectedYarn, setSelectedYarn] = useState<YarnSuggestion | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Запрос идёт не только в наш справочник, но и (best-effort) в Ravelry,
  // если своих подсказок не нашлось — заметно дольше обычного debounce-
  // автокомплита, пользователю нужно понимать, что идёт загрузка, а не что
  // поле просто не реагирует.
  const [isSearchingYarn, setIsSearchingYarn] = useState(false);
  // Отдельный индикатор для шага 2 Ravelry-фолбэка — выбор preview-
  // варианта требует ещё одного запроса (импорт в наш справочник), прежде
  // чем форма заполнится его данными.
  const [isImportingYarn, setIsImportingYarn] = useState(false);

  const [brand, setBrand] = useState('');
  const [mPer100g, setMPer100g] = useState('');
  const [composition, setComposition] = useState('');
  const [colorName, setColorName] = useState('');
  const [dyelot, setDyelot] = useState('');
  const [totalWeightG, setTotalWeightG] = useState('');
  const [note, setNote] = useState('');

  const [swatches, setSwatches] = useState<SwatchDraft[]>([]);
  const [uploadingSwatchKey, setUploadingSwatchKey] = useState<string | null>(null);
  const [isSwatchSectionOpen, setIsSwatchSectionOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const swatchFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    setImages([]);
    setNameQuery('');
    setSuggestions([]);
    setSelectedYarn(null);
    setShowSuggestions(false);
    setBrand('');
    setMPer100g('');
    setComposition('');
    setColorName('');
    setDyelot('');
    setTotalWeightG('');
    setNote('');
    setSwatches([]);
    setIsSwatchSectionOpen(false);
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (selectedYarn) return; // уже выбрали существующий артикул — не ищем заново
    if (nameQuery.trim().length < 3) {
      setSuggestions([]);
      setIsSearchingYarn(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Отменяет спиннер от УСТАРЕВШЕГО запроса — пользователь допечатал
    // дальше, пока предыдущий ещё летел (Ravelry-фолбэк заметно медленнее
    // обычного debounce), и его ответ пришёл позже нового ввода.
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setIsSearchingYarn(true);
      try {
        const items = await suggestStashYarns(nameQuery.trim());
        if (!cancelled) setSuggestions(items);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setIsSearchingYarn(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nameQuery, selectedYarn]);

  if (!isMounted) return null;

  const applySuggestion = (item: YarnSuggestion) => {
    setSelectedYarn(item);
    setNameQuery(item.name);
    setBrand(item.brand || '');
    setMPer100g(item.mPer100g != null ? String(item.mPer100g) : '');
    setComposition(item.composition || '');
    // Предзаполняем справочным фото (своим или скачанным из Ravelry-
    // фолбэка), только если пользователь ещё ничего сам не загрузил — не
    // затираем его собственные фото выбором подсказки.
    if (item.photoUrl) {
      setImages((prev) => (prev.length === 0 ? [item.photoUrl!] : prev));
    }
  };

  const handlePickSuggestion = async (item: YarnSuggestion) => {
    setShowSuggestions(false);
    // Preview-вариант из Ravelry (ravelryId без id) — записи ещё нет в
    // нашей БД. Импортируем ТОЛЬКО сейчас, по явному выбору пользователя —
    // не раньше (см. комментарий над searchRavelryPreview на бэкенде: до
    // этого рефакторинга запись создавалась уже на этапе поиска по
    // первому результату, и выбор не того варианта из нескольких блокировал
    // доступ к остальным).
    if (!item.id && item.ravelryId != null) {
      setIsImportingYarn(true);
      setNameQuery(item.name);
      try {
        const imported = await importRavelryYarn(item.ravelryId);
        applySuggestion(imported);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить данные пряжи');
      } finally {
        setIsImportingYarn(false);
      }
      return;
    }
    applySuggestion(item);
  };

  const handleNameChange = (value: string) => {
    setNameQuery(value);
    setSelectedYarn(null);
    setShowSuggestions(true);
  };

  const handleAddPhotoClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (images.length >= MAX_IMAGES) return;
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

  const updateSwatch = (key: string, patch: Partial<SwatchDraft>) => {
    setSwatches((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const handleAddSwatch = () => {
    setIsSwatchSectionOpen(true);
    setSwatches((prev) => [...prev, createEmptySwatchDraft()]);
  };

  const removeSwatch = (key: string) => {
    setSwatches((prev) => prev.filter((s) => s.key !== key));
    delete swatchFileInputRefs.current[key];
  };

  const handleSwatchFileSelected = (key: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const swatch = swatches.find((s) => s.key === key);
    if (!file || !swatch || swatch.images.length >= MAX_IMAGES) return;
    setUploadingSwatchKey(key);
    try {
      const url = await uploadStashImage(file);
      updateSwatch(key, { images: [...swatch.images, url] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото образца');
    } finally {
      setUploadingSwatchKey(null);
    }
  };

  const removeSwatchImage = (key: string, url: string) => {
    const swatch = swatches.find((s) => s.key === key);
    if (!swatch) return;
    updateSwatch(key, { images: swatch.images.filter((u) => u !== url) });
  };

  const isValid =
    nameQuery.trim().length > 0 &&
    (selectedYarn || brand.trim().length > 0) &&
    (selectedYarn || mPer100g.trim().length > 0) &&
    (selectedYarn || composition.trim().length > 0) &&
    Number(totalWeightG) > 0;

  const handleSave = async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      // Фото образцов дублируются в общую галерею мотка (не только в сам
      // StashSwatch) — пользователь ожидает видеть их на карточке пряжи
      // независимо от того, что фото пришло из блока "Образец", а не "Фото".
      // Лимит MAX_STASH_IMAGES_PER_SKEIN (5) применяется к объединённому
      // списку, лишние обрезаются здесь же, чтобы не улететь в 400 с бэкенда.
      const swatchImages = swatches.flatMap((s) => s.images);
      const combinedImages = [...new Set([...images, ...swatchImages])].slice(0, MAX_IMAGES);

      const skein = await createStashSkein({
        totalWeightG: Number(totalWeightG),
        images: combinedImages,
        colorName: colorName.trim() || undefined,
        dyelot: dyelot.trim() || undefined,
        note: note.trim() || undefined,
        ...(selectedYarn
          ? { yarnId: selectedYarn.id }
          : {
              newYarnName: nameQuery.trim(),
              newYarnBrand: brand.trim() || undefined,
              newYarnMPer100g: mPer100g ? Number(mPer100g) : undefined,
              newYarnComposition: composition.trim() || undefined,
            }),
      });

      // Артикул уже существовал (selectedYarn), но пользователь дозаполнил
      // пустое поле метража/состава — createSkein снапшотит Yarn as-is и
      // это значение из формы никуда не сохраняет (см. AddYarnModal disabled
      // логику выше), поэтому шлём отдельной заявкой на модерацию, тем же
      // путём, что и кнопка "Дозаполнить" на карточке пряжи. Бэкенд пишет
      // значение в snapshot этого же мотка сразу (видно владельцу
      // немедленно, справочник обновится только после одобрения) —
      // отражаем это в локальном объекте перед onCreated, иначе карточка в
      // списке хранилища показала бы "нет данных" до следующей перезагрузки.
      if (selectedYarn) {
        const suggestedMPer100g = selectedYarn.mPer100g == null && mPer100g.trim() ? Number(mPer100g) : undefined;
        const suggestedComposition = !selectedYarn.composition && composition.trim() ? composition.trim() : undefined;
        if (suggestedMPer100g !== undefined || suggestedComposition !== undefined) {
          try {
            await suggestYarnFields(skein.id, { mPer100g: suggestedMPer100g, composition: suggestedComposition });
            if (suggestedMPer100g !== undefined) skein.mPer100gSnapshot = suggestedMPer100g;
            if (suggestedComposition !== undefined) skein.compositionSnapshot = suggestedComposition;
          } catch {
            // Моток уже создан — не блокируем создание из-за необязательной
            // заявки на дозаполнение (тот же принцип, что у образцов ниже).
          }
        }
      }

      for (const swatch of swatches) {
        const hasData =
          swatch.needleSizeRaw.trim() || swatch.stitchesBefore || swatch.rowsBefore ||
          swatch.stitchesAfter || swatch.rowsAfter || swatch.images.length > 0;
        if (!hasData) continue;
        try {
          await createStashSwatch(skein.id, {
            images: swatch.images,
            needleSizeRaw: swatch.needleSizeRaw.trim() || undefined,
            densityStitchesBefore: swatch.stitchesBefore ? Number(swatch.stitchesBefore) : undefined,
            densityRowsBefore: swatch.rowsBefore ? Number(swatch.rowsBefore) : undefined,
            densityStitchesAfter: swatch.stitchesAfter ? Number(swatch.stitchesAfter) : undefined,
            densityRowsAfter: swatch.rowsAfter ? Number(swatch.rowsAfter) : undefined,
          });
        } catch {
          // Моток уже создан и сохранён — образец можно добавить позже со
          // страницы карточки, поэтому ошибка здесь не блокирует закрытие
          // формы и не откатывает уже успешное создание мотка. Остальные
          // образцы в цикле всё равно пробуют сохраниться.
        }
      }

      onCreated(skein);
    } catch (err) {
      if (err instanceof StashLimitReachedError) {
        onLimitReached();
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось добавить пряжу');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div ref={sheetRef} className={`add-yarn-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="add-yarn-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="add-yarn-header">
          <h2 className="add-yarn-title">Новая пряжа</h2>
        </div>

        <div className="add-yarn-body">
          <div className="add-yarn-section">
            <p className="add-yarn-section-title">Фото</p>
            <div className="add-yarn-photos">
              {images.map((url) => (
                <div key={url} className="add-yarn-photo-thumb">
                  <img src={url} alt="" />
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

            <div className="add-yarn-field add-yarn-field--autocomplete">
              <label className="add-yarn-label">Название*</label>
              <div className="add-yarn-input-wrap">
                <input
                  className="add-yarn-input"
                  value={nameQuery}
                  placeholder="Введите текст..."
                  onChange={(e) => handleNameChange(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                />
                {(isSearchingYarn || isImportingYarn) && (
                  <span className="add-yarn-input-spinner-wrap">
                    <Loader2 size={18} strokeWidth={2} className="add-yarn-input-spinner" />
                  </span>
                )}
              </div>
              {showSuggestions && suggestions.length > 0 && (
                <div className="add-yarn-suggestions">
                  {suggestions.map((s) => (
                    <button
                      key={s.id ?? `ravelry-${s.ravelryId}`}
                      type="button"
                      className="add-yarn-suggestion"
                      onClick={() => handlePickSuggestion(s)}
                      disabled={isImportingYarn}
                    >
                      {s.name}{s.brand ? ` — ${s.brand}` : ''}
                      {s.fromRavelry && <span className="add-yarn-suggestion-source">Данные с Ravelry</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Бренд{!selectedYarn && '*'}</label>
              <input
                className="add-yarn-input"
                value={brand}
                placeholder="Введите текст..."
                onChange={(e) => setBrand(e.target.value)}
                disabled={!!selectedYarn}
              />
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Метраж{!selectedYarn && '*'}</label>
              <input
                className="add-yarn-input"
                value={mPer100g}
                placeholder="Введите текст..."
                inputMode="numeric"
                onChange={(e) => setMPer100g(e.target.value)}
                disabled={!!selectedYarn && selectedYarn.mPer100g != null}
              />
              {selectedYarn && selectedYarn.mPer100g == null && (
                <p className="add-yarn-field-hint">
                  В справочнике это поле не заполнено — укажите значение, оно уйдёт на проверку модератору.
                </p>
              )}
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Состав{!selectedYarn && '*'}</label>
              <input
                className="add-yarn-input"
                value={composition}
                placeholder="Введите текст..."
                onChange={(e) => setComposition(e.target.value)}
                disabled={!!selectedYarn && !!selectedYarn.composition}
              />
              {selectedYarn && !selectedYarn.composition && (
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
              <label className="add-yarn-label">Остаток*</label>
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

            {isSwatchSectionOpen && swatches.map((swatch, index) => (
              <div key={swatch.key} className="add-yarn-swatch-draft">
                {swatches.length > 1 && (
                  <div className="add-yarn-swatch-draft-header">
                    <span className="add-yarn-swatch-draft-title">Образец {index + 1}</span>
                    <button type="button" className="add-yarn-swatch-remove" onClick={() => removeSwatch(swatch.key)}>
                      Удалить
                    </button>
                  </div>
                )}

                <div className="add-yarn-field">
                  <label className="add-yarn-label">Размер спицы</label>
                  <input
                    className="add-yarn-input"
                    value={swatch.needleSizeRaw}
                    placeholder="Введите текст..."
                    onChange={(e) => updateSwatch(swatch.key, { needleSizeRaw: e.target.value })}
                  />
                </div>

                <div className="add-yarn-field">
                  <label className="add-yarn-label">До ВТО</label>
                  <div className="add-yarn-density-row">
                    <div className="add-yarn-density-col">
                      <input className="add-yarn-input" value={swatch.stitchesBefore} placeholder="Петли" inputMode="decimal" onChange={(e) => updateSwatch(swatch.key, { stitchesBefore: e.target.value })} />
                      <span className="add-yarn-density-sublabel">Петли</span>
                    </div>
                    <span className="add-yarn-density-x">х</span>
                    <div className="add-yarn-density-col">
                      <input className="add-yarn-input" value={swatch.rowsBefore} placeholder="Ряды" inputMode="decimal" onChange={(e) => updateSwatch(swatch.key, { rowsBefore: e.target.value })} />
                      <span className="add-yarn-density-sublabel">Ряды</span>
                    </div>
                  </div>
                </div>

                <div className="add-yarn-field">
                  <label className="add-yarn-label">После ВТО</label>
                  <div className="add-yarn-density-row">
                    <div className="add-yarn-density-col">
                      <input className="add-yarn-input" value={swatch.stitchesAfter} placeholder="Петли" inputMode="decimal" onChange={(e) => updateSwatch(swatch.key, { stitchesAfter: e.target.value })} />
                      <span className="add-yarn-density-sublabel">Петли</span>
                    </div>
                    <span className="add-yarn-density-x">х</span>
                    <div className="add-yarn-density-col">
                      <input className="add-yarn-input" value={swatch.rowsAfter} placeholder="Ряды" inputMode="decimal" onChange={(e) => updateSwatch(swatch.key, { rowsAfter: e.target.value })} />
                      <span className="add-yarn-density-sublabel">Ряды</span>
                    </div>
                  </div>
                </div>

                <div className="add-yarn-field">
                  <label className="add-yarn-label">Фото образца</label>
                  <div className="add-yarn-photos">
                    {swatch.images.map((url) => (
                      <div key={url} className="add-yarn-photo-thumb">
                        <img src={url} alt="" />
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
                      style={{ display: 'none' }}
                      onChange={handleSwatchFileSelected(swatch.key)}
                    />
                  </div>
                </div>
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
