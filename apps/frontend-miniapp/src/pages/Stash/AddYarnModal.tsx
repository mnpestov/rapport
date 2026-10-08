import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { parseDecimalInput } from '../../utils/parseDecimal';
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
  instrumentType: 'hook' | 'needle' | null;
  needleSizeRaw: string;
  strandsCount: string;
  stitchesBefore: string;
  rowsBefore: string;
  stitchesAfter: string;
  rowsAfter: string;
  note: string;
  images: string[];
}

function createEmptySwatchDraft(): SwatchDraft {
  return {
    key: `${Date.now()}-${Math.random()}`,
    instrumentType: null,
    needleSizeRaw: '',
    strandsCount: '',
    stitchesBefore: '',
    rowsBefore: '',
    stitchesAfter: '',
    rowsAfter: '',
    note: '',
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
  // Предзаполняет поле названия текстом, который пользователь уже ввёл в
  // поиске пряжи (например, в форме проекта — искал моток в хранилище,
  // ничего не нашлось, нажал "Добавить пряжу") — не заставляет вводить то
  // же самое название заново.
  initialNameQuery?: string;
}

export const AddYarnModal: React.FC<AddYarnModalProps> = ({ isOpen, onClose, onCreated, onLimitReached, initialNameQuery }) => {
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
  // Infinite scroll по Ravelry-результатам в списке подсказок — page
  // отслеживает, какая страница уже загружена, hasMoreFromRavelry/
  // isLoadingMoreYarn управляют, когда показывать индикатор подгрузки и
  // разрешать следующий запрос при доскролле до конца списка.
  const [yarnSuggestPage, setYarnSuggestPage] = useState(1);
  const [hasMoreFromRavelry, setHasMoreFromRavelry] = useState(false);
  const [isLoadingMoreYarn, setIsLoadingMoreYarn] = useState(false);
  const suggestionsListRef = useRef<HTMLDivElement>(null);
  const autocompleteFieldRef = useRef<HTMLDivElement>(null);

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
  const nameInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    setImages([]);
    setNameQuery(initialNameQuery ?? '');
    setSuggestions([]);
    setSelectedYarn(null);
    // Пришли сюда уже с текстом поиска (не нашли пряжу в хранилище,
    // нажали "Добавить пряжу") — сразу открываем список подсказок и
    // ставим фокус на поле, как будто пользователь только что кликнул в
    // него сам, а не заставляем тыкать в поле заново, чтобы что-то увидеть.
    setShowSuggestions(!!initialNameQuery);
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
    if (initialNameQuery) {
      // Модалка ещё доигрывает анимацию появления (useSheetTransition) —
      // .focus() на не полностью смонтированном/невидимом элементе иногда
      // тихо не срабатывает в мобильных WebView, микрозадержка даёт DOM
      // осесть перед фокусом.
      const timer = setTimeout(() => nameInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialNameQuery]);

  useEffect(() => {
    if (selectedYarn) return; // уже выбрали существующий артикул — не ищем заново
    if (nameQuery.trim().length < 3) {
      setSuggestions([]);
      setIsSearchingYarn(false);
      setHasMoreFromRavelry(false);
      setYarnSuggestPage(1);
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
        // Новый текст запроса — всегда с первой страницы, старые
        // Ravelry-результаты предыдущего запроса больше не релевантны.
        const { items, hasMoreFromRavelry: more } = await suggestStashYarns(nameQuery.trim(), {
          page: 1,
          brand: brand.trim() || undefined,
        });
        if (!cancelled) {
          setSuggestions(items);
          setHasMoreFromRavelry(more);
          setYarnSuggestPage(1);
        }
      } catch (err) {
        console.error('[AddYarnModal] yarn suggest search failed:', err);
        if (!cancelled) {
          setSuggestions([]);
          setHasMoreFromRavelry(false);
        }
      } finally {
        if (!cancelled) setIsSearchingYarn(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- brand читается
    // как "значение на момент запроса", не должно перезапускать поиск само
    // по себе (иначе печать в поле "Бренд" дёргала бы автокомплит названия).
  }, [nameQuery, selectedYarn]);

  // Инфинити-скролл: доскроллили список подсказок почти до конца — грузим
  // следующую страницу Ravelry-результатов, если она есть.
  const handleSuggestionsScroll = () => {
    const el = suggestionsListRef.current;
    if (!el || isLoadingMoreYarn || !hasMoreFromRavelry) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!nearBottom) return;

    const nextPage = yarnSuggestPage + 1;
    setIsLoadingMoreYarn(true);
    suggestStashYarns(nameQuery.trim(), { page: nextPage, brand: brand.trim() || undefined })
      .then(({ items, hasMoreFromRavelry: more }) => {
        setSuggestions((prev) => [...prev, ...items]);
        setHasMoreFromRavelry(more);
        setYarnSuggestPage(nextPage);
      })
      .catch((err) => {
        console.error('[AddYarnModal] load more yarn suggestions failed:', err);
        setHasMoreFromRavelry(false);
      })
      .finally(() => setIsLoadingMoreYarn(false));
  };

  // Клик вне поля автокомплита — закрывает список подсказок, чтобы
  // пользователь мог спокойно ввести данные вручную (Бренд/Метраж/Состав),
  // не отвлекаясь на висящий список поверх остальной формы.
  useEffect(() => {
    if (!showSuggestions) return;
    const handleClickOutside = (e: Event) => {
      if (autocompleteFieldRef.current && !autocompleteFieldRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showSuggestions]);

  if (!isMounted) return null;

  const applySuggestion = (item: YarnSuggestion) => {
    setSelectedYarn(item);
    setNameQuery(item.name);
    setBrand(item.brand || '');
    setMPer100g(item.mPer100g != null ? String(item.mPer100g) : '');
    setComposition(item.composition || '');
    // Фото справочной записи НЕ предзаполняется — было убрано намеренно:
    // фото из Ravelry привязано к чужому цвету/партии конкретного мотка,
    // который загрузил кто-то другой, и часто не соответствует реальной
    // пряже пользователя. Пользователь загружает своё фото сам.
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
        console.error('[AddYarnModal] importRavelryYarn failed:', err);
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
      console.error('[AddYarnModal] image upload failed:', err);
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
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploadingSwatchKey(key);
    try {
      for (const file of files) {
        // Читаем актуальный образец через setSwatches, а не через swatches.find()
        // из замыкания — иначе stale closure при 3+ образцах находит не тот
        // объект (или вовсе undefined, если образец был удалён после создания
        // обработчика), и ограничение MAX_IMAGES не работает корректно.
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
      console.error('[AddYarnModal] swatch image upload failed:', err);
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
      const skein = await createStashSkein({
        totalWeightG: Number(totalWeightG),
        images,
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

      // Артикул уже существовал (selectedYarn), но пользователь ввёл
      // метраж/состав, отличающийся от справочника (дозаполнение пустого
      // поля или исправление уже заполненного) — createSkein снапшотит Yarn
      // as-is и это значение из формы никуда не сохраняет, поэтому шлём
      // отдельной заявкой на модерацию, тем же путём, что и кнопка
      // "Дозаполнить" на карточке пряжи. Бэкенд пишет значение в snapshot
      // этого же мотка сразу (видно владельцу немедленно, справочник
      // обновится только после одобрения) — отражаем это в локальном
      // объекте перед onCreated, иначе карточка в списке хранилища показала
      // бы старое значение до следующей перезагрузки.
      if (selectedYarn) {
        const typedMPer100g = mPer100g.trim() ? Number(mPer100g) : null;
        const typedComposition = composition.trim() || null;
        const suggestedMPer100g = typedMPer100g !== null && typedMPer100g !== selectedYarn.mPer100g ? typedMPer100g : undefined;
        const suggestedComposition = typedComposition !== null && typedComposition !== (selectedYarn.composition || null) ? typedComposition : undefined;
        if (suggestedMPer100g !== undefined || suggestedComposition !== undefined) {
          try {
            await suggestYarnFields(skein.id, { mPer100g: suggestedMPer100g, composition: suggestedComposition });
            if (suggestedMPer100g !== undefined) skein.mPer100gSnapshot = suggestedMPer100g;
            if (suggestedComposition !== undefined) skein.compositionSnapshot = suggestedComposition;
          } catch (err) {
            // Моток уже создан — не блокируем создание из-за необязательной
            // заявки на дозаполнение (тот же принцип, что у образцов ниже).
            console.error('[AddYarnModal] suggestYarnFields failed:', err);
          }
        }
      }

      for (const swatch of swatches) {
        const hasData =
          swatch.instrumentType || swatch.needleSizeRaw.trim() || swatch.stitchesBefore || swatch.rowsBefore ||
          swatch.strandsCount || swatch.stitchesAfter || swatch.rowsAfter || swatch.note.trim() || swatch.images.length > 0;
        if (!hasData) continue;
        try {
          await createStashSwatch(skein.id, {
            images: swatch.images,
            needleSizeRaw: swatch.needleSizeRaw.trim() || undefined,
            instrumentType: swatch.instrumentType ?? undefined,
            strandsCount: swatch.strandsCount ? Number(swatch.strandsCount) : undefined,
            densityStitchesBefore: parseDecimalInput(swatch.stitchesBefore),
            densityRowsBefore: parseDecimalInput(swatch.rowsBefore),
            densityStitchesAfter: parseDecimalInput(swatch.stitchesAfter),
            densityRowsAfter: parseDecimalInput(swatch.rowsAfter),
            note: swatch.note.trim() || undefined,
          });
        } catch (err) {
          // Моток уже создан и сохранён — образец можно добавить позже со
          // страницы карточки, поэтому ошибка здесь не блокирует закрытие
          // формы и не откатывает уже успешное создание мотка. Остальные
          // образцы в цикле всё равно пробуют сохраниться.
          console.error('[AddYarnModal] createStashSwatch failed:', err);
        }
      }

      onCreated(skein);
    } catch (err) {
      if (err instanceof StashLimitReachedError) {
        onLimitReached();
        return;
      }
      console.error('[AddYarnModal] handleSave failed:', err);
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
                multiple
                style={{ display: 'none' }}
                onChange={handleFileSelected}
              />
            </div>
          </div>

          <div className="add-yarn-section">
            <p className="add-yarn-section-title">Пряжа</p>

            <div className="add-yarn-field add-yarn-field--autocomplete" ref={autocompleteFieldRef}>
              <label className="add-yarn-label">Артикул *</label>
              <div className="add-yarn-input-wrap">
                <input
                  ref={nameInputRef}
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
                <div className="add-yarn-suggestions" ref={suggestionsListRef} onScroll={handleSuggestionsScroll}>
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
                  {isLoadingMoreYarn && (
                    <div className="add-yarn-suggestions-loading">
                      <Loader2 size={16} strokeWidth={2} className="add-yarn-input-spinner" />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Бренд{!selectedYarn && ' *'}</label>
              <input
                className="add-yarn-input"
                value={brand}
                placeholder="Введите текст..."
                onChange={(e) => setBrand(e.target.value)}
                disabled={!!selectedYarn}
              />
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Метраж{!selectedYarn && ' (м/100г) *'}</label>
              <input
                className="add-yarn-input"
                value={mPer100g}
                placeholder="Введите текст..."
                inputMode="numeric"
                onChange={(e) => setMPer100g(e.target.value)}
              />
              {selectedYarn && selectedYarn.mPer100g == null && (
                <p className="add-yarn-field-hint">
                  В справочнике это поле не заполнено — укажите значение, оно уйдёт на проверку модератору.
                </p>
              )}
              {selectedYarn && selectedYarn.mPer100g != null && (
                <p className="add-yarn-field-hint">
                  Если это значение отличается от справочника ({selectedYarn.mPer100g} м/100г), исправление уйдёт на проверку модератору.
                </p>
              )}
            </div>

            <div className="add-yarn-field">
              <label className="add-yarn-label">Состав{!selectedYarn && ' *'}</label>
              <input
                className="add-yarn-input"
                value={composition}
                placeholder="Введите текст..."
                onChange={(e) => setComposition(e.target.value)}
              />
              {selectedYarn && !selectedYarn.composition && (
                <p className="add-yarn-field-hint">
                  В справочнике это поле не заполнено — укажите значение, оно уйдёт на проверку модератору.
                </p>
              )}
              {selectedYarn && selectedYarn.composition && (
                <p className="add-yarn-field-hint">
                  Если это значение отличается от справочника ({selectedYarn.composition}), исправление уйдёт на проверку модератору.
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
              <label className="add-yarn-label">Остаток (г) *</label>
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
                <div className="add-yarn-swatch-draft-header">
                  <span className="add-yarn-swatch-draft-title">Образец {index + 1}</span>
                  <button type="button" className="add-yarn-swatch-remove" onClick={() => removeSwatch(swatch.key)}>
                    Удалить
                  </button>
                </div>

                <div className="add-yarn-field">
                  <label className="add-yarn-label">Инструмент</label>
                  <div className="add-yarn-instrument-type-row">
                    <button
                      type="button"
                      className={`add-yarn-instrument-chip${swatch.instrumentType === 'needle' ? ' add-yarn-instrument-chip--active' : ''}`}
                      onClick={() => updateSwatch(swatch.key, { instrumentType: swatch.instrumentType === 'needle' ? null : 'needle' })}
                    >
                      Спицы
                    </button>
                    <button
                      type="button"
                      className={`add-yarn-instrument-chip${swatch.instrumentType === 'hook' ? ' add-yarn-instrument-chip--active' : ''}`}
                      onClick={() => updateSwatch(swatch.key, { instrumentType: swatch.instrumentType === 'hook' ? null : 'hook' })}
                    >
                      Крючок
                    </button>
                  </div>
                </div>

                {(swatch.instrumentType || swatch.needleSizeRaw.trim()) && (
                  <div className="add-yarn-field">
                    <label className="add-yarn-label">Размер {swatch.instrumentType === 'needle' ? 'спиц' : swatch.instrumentType === 'hook' ? 'крючка' : 'инструмента'}</label>
                    <input
                      className="add-yarn-input"
                      value={swatch.needleSizeRaw}
                      placeholder="Например: 3.5"
                      inputMode="decimal"
                      onChange={(e) => updateSwatch(swatch.key, { needleSizeRaw: e.target.value })}
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
                    onChange={(e) => updateSwatch(swatch.key, { strandsCount: e.target.value })}
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
                  <label className="add-yarn-label">Заметка</label>
                  <textarea
                    className="add-yarn-textarea"
                    value={swatch.note}
                    placeholder="Любые наблюдения об образце..."
                    onChange={(e) => updateSwatch(swatch.key, { note: e.target.value })}
                  />
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
                      multiple
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
