import React, { useEffect, useRef, useState } from 'react';
import { Plus, Lock } from 'lucide-react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import {
  logStashUsage,
  fetchStashMatches,
  uploadStashImage,
  StashSkein,
  StashMatchItem,
} from '../../api/stashApi';
import { fetchPatterns, Pattern } from '../../api/patternsApi';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';
import '../../styles/sheet.css';
import './LogUsageWizard.css';

const MAX_PHOTOS = 5;
const TOTAL_STEPS = 3;

// Общая форма карточки описания в вертикальном списке шага 2 — и подборка
// (StashMatchItem), и результаты поиска (Pattern) сводятся к ней.
interface RelatedPatternCard {
  id: string;
  title: string;
  thumbnailUrl: string;
  authorName: string;
  instruments: string[];
}

interface LogUsageWizardProps {
  isOpen: boolean;
  skein: StashSkein;
  onClose: () => void;
  onLogged: () => void;
}

export const LogUsageWizard: React.FC<LogUsageWizardProps> = ({ isOpen, skein, onClose, onLogged }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  const [step, setStep] = useState(1);

  // Шаг 1
  const [amountG, setAmountG] = useState('');
  const [logAll, setLogAll] = useState(false);
  const [needleSizeRaw, setNeedleSizeRaw] = useState('');

  // Шаг 2
  const [projectTitle, setProjectTitle] = useState('');
  const [matches, setMatches] = useState<StashMatchItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Pattern[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<{ id: string; title: string } | null>(null);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [manualAuthorName, setManualAuthorName] = useState('');
  const [manualDescriptionTitle, setManualDescriptionTitle] = useState('');
  const [isMatchesLocked, setIsMatchesLocked] = useState(false);
  const [isMatchesPaywallOpen, setIsMatchesPaywallOpen] = useState(false);

  // Шаг 3
  const [photos, setPhotos] = useState<string[]>([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setAmountG('');
    setLogAll(false);
    setNeedleSizeRaw('');
    setProjectTitle('');
    setMatches([]);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedPattern(null);
    setIsManualEntryOpen(false);
    setManualAuthorName('');
    setManualDescriptionTitle('');
    setPhotos([]);
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (step !== 2 || !isOpen) return;
    setMatchesLoading(true);
    fetchStashMatches(skein.id)
      .then((res) => { setMatches(res.items); setIsMatchesLocked(res.isLocked); })
      .catch(() => { setMatches([]); setIsMatchesLocked(false); })
      .finally(() => setMatchesLoading(false));
  }, [step, isOpen, skein.id]);

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetchPatterns({ search: searchQuery.trim(), limit: 10 });
        setSearchResults(res.data);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]);

  if (!isMounted) return null;

  const effectiveAmount = logAll ? skein.currentWeightG : Number(amountG) || 0;
  const remainderAfter = skein.currentWeightG - effectiveAmount;
  const isStep1Valid = effectiveAmount > 0 && effectiveAmount <= skein.currentWeightG;

  const handleAmountChange = (value: string) => {
    setAmountG(value);
    setLogAll(false);
  };

  const handleToggleLogAll = () => {
    setLogAll((prev) => {
      const next = !prev;
      if (next) setAmountG(String(skein.currentWeightG));
      return next;
    });
  };

  const handlePickPattern = (id: string, title: string) => {
    setSelectedPattern((prev) => (prev?.id === id ? null : { id, title }));
    setIsManualEntryOpen(false);
  };

  const handleOpenManualEntry = () => {
    setSelectedPattern(null);
    setIsManualEntryOpen(true);
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) return;
    const toUpload = files.slice(0, remainingSlots);
    setIsUploadingPhoto(true);
    try {
      // Последовательно, не Promise.all — иначе конкурентные вызовы
      // uploadStashImage перегружают тот же multer-эндпоинт, что и остальные
      // формы хранилища, без выигрыша в UX (индикатор загрузки один общий).
      for (const file of toUpload) {
        const url = await uploadStashImage(file);
        setPhotos((prev) => [...prev, url]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const removePhoto = (url: string) => setPhotos((prev) => prev.filter((u) => u !== url));

  const goNext = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await logStashUsage(skein.id, {
        amountG: effectiveAmount,
        needleSizeRaw: needleSizeRaw.trim() || undefined,
        projectTitle: projectTitle.trim() || undefined,
        patternId: selectedPattern?.id,
        manualAuthorName: !selectedPattern ? manualAuthorName.trim() || undefined : undefined,
        manualDescriptionTitle: !selectedPattern ? manualDescriptionTitle.trim() || undefined : undefined,
        finishedPhotos: photos,
      });
      onLogged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось списать пряжу');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepTitle = `Шаг ${step} из ${TOTAL_STEPS}`;

  // Подборка (StashMatchItem) показывается сразу, пока поиск пуст; как
  // только начат ввод — список заменяется результатами поиска (§10 плана:
  // подборка экономит набор текста в частом случае, поиск — запасной путь).
  const relatedCards: RelatedPatternCard[] = searchQuery.trim().length >= 2
    ? searchResults.map((p) => ({ id: p.id, title: p.title, thumbnailUrl: p.thumbnailUrl, authorName: p.author, instruments: p.instruments }))
    : matches.map((m) => ({ id: m.id, title: m.title, thumbnailUrl: m.thumbnailUrl, authorName: m.authorName, instruments: m.instruments }));
  const isShowingSearch = searchQuery.trim().length >= 2;
  const isRelatedLoading = isShowingSearch ? isSearching : matchesLoading;

  return (
    <div ref={sheetRef} className={`log-usage-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="log-usage-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="log-usage-header">
          <p className="log-usage-step">{stepTitle}</p>
          <h2 className="log-usage-title">{skein.yarnNameSnapshot}</h2>
        </div>

        <div className="log-usage-body">
          {step === 1 && (
            <>
              <div className="log-usage-remainder">
                <p className="log-usage-remainder-row"><b>Остаток:</b> {skein.currentWeightG} г из {skein.totalWeightG} г</p>
                <div className="stash-progress-bar">
                  <div
                    className="stash-progress-fill"
                    style={{ width: `${skein.totalWeightG > 0 ? (skein.currentWeightG / skein.totalWeightG) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <div className="log-usage-field">
                <label className="log-usage-label">Укажите количество, которое хотите списать:</label>
                <input
                  className="log-usage-input"
                  value={amountG}
                  placeholder="Вес в граммах"
                  inputMode="numeric"
                  onChange={(e) => handleAmountChange(e.target.value)}
                  disabled={logAll}
                />
              </div>

              <div className="log-usage-field">
                <label className="log-usage-label">Основной размер спиц</label>
                <input
                  className="log-usage-input"
                  value={needleSizeRaw}
                  placeholder="Введите число"
                  onChange={(e) => setNeedleSizeRaw(e.target.value)}
                />
              </div>

              <label className="log-usage-checkbox-row">
                <input type="checkbox" checked={logAll} onChange={handleToggleLogAll} />
                <span>Списать пряжу полностью</span>
              </label>
              <p className="log-usage-checkbox-hint">{skein.currentWeightG} г из {skein.totalWeightG} г</p>

              {amountG && !logAll && Number(amountG) > skein.currentWeightG && (
                <p className="log-usage-error">Недостаточно пряжи: осталось {skein.currentWeightG} г</p>
              )}
              {isStep1Valid && (
                <p className="log-usage-hint">Останется: {remainderAfter} г из {skein.totalWeightG} г</p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="log-usage-field">
                <label className="log-usage-label">Название проекта</label>
                <input
                  className="log-usage-input"
                  value={projectTitle}
                  placeholder="Введите название проекта"
                  onChange={(e) => setProjectTitle(e.target.value)}
                />
              </div>

              <div className="log-usage-field">
                <label className="log-usage-label">Описание</label>
                <div className="log-usage-input-lock-wrap">
                  <input
                    className="log-usage-input"
                    value={searchQuery}
                    placeholder="Введите название или автора"
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={isMatchesLocked}
                    onFocus={() => { if (isMatchesLocked) setIsMatchesPaywallOpen(true); }}
                    readOnly={isMatchesLocked}
                  />
                  {isMatchesLocked && (
                    <button type="button" className="log-usage-input-lock" onClick={() => setIsMatchesPaywallOpen(true)} aria-label="Доступно с подпиской">
                      <Lock size={16} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              </div>

              <div className="log-usage-related">
                <p className="log-usage-section-title">Что можно связать из этой пряжи</p>
                {isMatchesLocked ? (
                  <>
                    <button
                      type="button"
                      className="log-usage-manual-add-btn"
                      onClick={handleOpenManualEntry}
                    >
                      <Plus size={16} strokeWidth={1.5} />
                      Добавить вручную
                    </button>
                    {isManualEntryOpen && (
                      <div className="log-usage-manual-entry">
                        <div className="log-usage-field">
                          <label className="log-usage-label">Автор</label>
                          <input
                            className="log-usage-input"
                            value={manualAuthorName}
                            placeholder="Введите имя автора"
                            onChange={(e) => setManualAuthorName(e.target.value)}
                          />
                        </div>
                        <div className="log-usage-field">
                          <label className="log-usage-label">Описание</label>
                          <input
                            className="log-usage-input"
                            value={manualDescriptionTitle}
                            placeholder="Введите название проекта"
                            onChange={(e) => setManualDescriptionTitle(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {isRelatedLoading && <p className="loading-message">Загрузка...</p>}
                    {!isRelatedLoading && isShowingSearch && relatedCards.length === 0 && !isManualEntryOpen && (
                      <>
                        <p className="log-usage-empty-text">Ничего не найдено</p>
                        <button type="button" className="log-usage-manual-add-btn" onClick={handleOpenManualEntry}>
                          <Plus size={16} strokeWidth={1.5} />
                          Добавить вручную
                        </button>
                      </>
                    )}
                    {!isRelatedLoading && relatedCards.length > 0 && (
                      <div className="log-usage-cards-vertical">
                        {relatedCards.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={`log-usage-card-row${selectedPattern?.id === p.id ? ' log-usage-card-row--selected' : ''}`}
                            onClick={() => handlePickPattern(p.id, p.title)}
                          >
                            <img src={p.thumbnailUrl} alt="" className="log-usage-card-row-image" />
                            <div className="log-usage-card-row-body">
                              <p className="log-usage-card-row-title">{p.title}</p>
                              <p className="log-usage-card-row-meta"><b>Автор:</b> {p.authorName}</p>
                              {p.instruments.length > 0 && (
                                <p className="log-usage-card-row-meta"><b>Инструмент:</b> {p.instruments.join(', ')}</p>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {isManualEntryOpen && (
                      <div className="log-usage-manual-entry">
                        <div className="log-usage-field">
                          <label className="log-usage-label">Автор</label>
                          <input
                            className="log-usage-input"
                            value={manualAuthorName}
                            placeholder="Введите имя автора"
                            onChange={(e) => setManualAuthorName(e.target.value)}
                          />
                        </div>
                        <div className="log-usage-field">
                          <label className="log-usage-label">Описание</label>
                          <input
                            className="log-usage-input"
                            value={manualDescriptionTitle}
                            placeholder="Введите название проекта"
                            onChange={(e) => setManualDescriptionTitle(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {step === 3 && (
            <div className="log-usage-field">
              <label className="log-usage-label">Фото готового изделия</label>
              <div className="log-usage-photos">
                {photos.map((url) => (
                  <div key={url} className="log-usage-photo-thumb">
                    <img src={url} alt="" />
                    <button type="button" className="log-usage-photo-remove" onClick={() => removePhoto(url)}>×</button>
                  </div>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <button type="button" className="log-usage-photo-add" onClick={() => photoInputRef.current?.click()} disabled={isUploadingPhoto}>
                    +
                  </button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handlePhotoSelected}
                />
              </div>
              <p className="log-usage-photo-hint">Первое фото — обложка.</p>
            </div>
          )}

          {error && <p className="log-usage-error">{error}</p>}
        </div>

        <div className="log-usage-footer">
          {step < TOTAL_STEPS ? (
            <button type="button" className="btn log-usage-next-btn" onClick={goNext} disabled={step === 1 && !isStep1Valid}>
              Далее
            </button>
          ) : (
            <button type="button" className="btn log-usage-next-btn" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Сохранение...' : 'Сохранить'}
            </button>
          )}
          <button type="button" className="btn log-usage-close-btn" onClick={step === 1 ? onClose : goBack} disabled={isSubmitting}>
            {step === 1 ? 'Закрыть' : 'Назад'}
          </button>
        </div>
      </div>

      <StashPaywallBanner
        isOpen={isMatchesPaywallOpen}
        reason="matches"
        freeLimit={10}
        onClose={() => setIsMatchesPaywallOpen(false)}
      />
    </div>
  );
};
