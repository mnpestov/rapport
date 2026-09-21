import React, { useEffect, useRef, useState } from 'react';
import { Plus, Lock } from 'lucide-react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import {
  updateStashUsage,
  fetchStashMatches,
  uploadStashImage,
  StashSkein,
  StashUsage,
  StashMatchItem,
} from '../../api/stashApi';
import { fetchPatterns, Pattern } from '../../api/patternsApi';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';
import '../../styles/sheet.css';
import './LogUsageWizard.css';

const MAX_PHOTOS = 5;

interface RelatedPatternCard {
  id: string;
  title: string;
  thumbnailUrl: string;
  authorName: string;
  instruments: string[];
}

interface EditUsageModalProps {
  isOpen: boolean;
  skein: StashSkein;
  usage: StashUsage;
  onClose: () => void;
  onSaved: () => void;
}

// Та же вёрстка/CSS-классы, что у LogUsageWizard (шаги 2 и 3) — по тому же
// принципу, что EditSkeinModal переиспользует классы AddYarnModal: кнопка
// "Редактировать" должна открывать визуально идентичную форму. Отличия
// осознанные, не пропуски:
// - Нет шага 1 (вес/остаток) — amountG не редактируется (см. комментарий у
//   updateUsage на бэкенде: влияет на currentWeightG мотка, для этого есть
//   отдельный путь — отменить списание и списать заново).
// - Один экран без степпера — оставшихся полей мало, разбивать незачем.
export const EditUsageModal: React.FC<EditUsageModalProps> = ({ isOpen, skein, usage, onClose, onSaved }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  const [needleSizeRaw, setNeedleSizeRaw] = useState('');
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

  const [photos, setPhotos] = useState<string[]>([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    setNeedleSizeRaw(usage.needleSizeRaw || '');
    setProjectTitle(usage.projectTitle || '');
    setSearchQuery('');
    setSearchResults([]);
    // patternId живёт, пока Pattern существует — если он есть, предзаполняем
    // выбор описания тем же способом, что шаг 2 в LogUsageWizard, снимки
    // (title/author) остаются на самой usage независимо от этого выбора.
    setSelectedPattern(usage.patternId ? { id: usage.patternId, title: usage.patternTitleSnapshot || '' } : null);
    setIsManualEntryOpen(!usage.patternId && !!(usage.patternTitleSnapshot || usage.patternAuthorSnapshot));
    setManualAuthorName(!usage.patternId ? usage.patternAuthorSnapshot || '' : '');
    setManualDescriptionTitle(!usage.patternId ? usage.patternTitleSnapshot || '' : '');
    setPhotos(usage.finishedPhotos);
    setError(null);
  }, [isOpen, usage]);

  useEffect(() => {
    if (!isOpen) return;
    setMatchesLoading(true);
    fetchStashMatches(skein.id)
      .then((res) => { setMatches(res.items); setIsMatchesLocked(res.isLocked); })
      .catch(() => { setMatches([]); setIsMatchesLocked(false); })
      .finally(() => setMatchesLoading(false));
  }, [isOpen, skein.id]);

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

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await updateStashUsage(usage.id, {
        needleSizeRaw: needleSizeRaw.trim() || undefined,
        projectTitle: projectTitle.trim() || undefined,
        patternId: selectedPattern?.id,
        manualAuthorName: !selectedPattern ? manualAuthorName.trim() || undefined : undefined,
        manualDescriptionTitle: !selectedPattern ? manualDescriptionTitle.trim() || undefined : undefined,
        finishedPhotos: photos,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить изменения');
    } finally {
      setIsSubmitting(false);
    }
  };

  const relatedCards: RelatedPatternCard[] = searchQuery.trim().length >= 2
    ? searchResults.map((p) => ({ id: p.id, title: p.title, thumbnailUrl: p.thumbnailUrl, authorName: p.author, instruments: p.instruments }))
    : matches.map((m) => ({ id: m.id, title: m.title, thumbnailUrl: m.thumbnailUrl, authorName: m.authorName, instruments: m.instruments }));
  const isShowingSearch = searchQuery.trim().length >= 2;
  const isRelatedLoading = isShowingSearch ? isSearching : matchesLoading;

  return (
    <div ref={sheetRef} className={`log-usage-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="log-usage-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="log-usage-header">
          <h2 className="log-usage-title">Редактировать проект</h2>
        </div>

        <div className="log-usage-body">
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
            <label className="log-usage-label">Основной размер спиц</label>
            <input
              className="log-usage-input"
              value={needleSizeRaw}
              placeholder="Введите число"
              onChange={(e) => setNeedleSizeRaw(e.target.value)}
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

          {selectedPattern && !isShowingSearch && (
            <p className="log-usage-empty-text">Выбрано: {selectedPattern.title}</p>
          )}

          <div className="log-usage-related">
            <p className="log-usage-section-title">Что можно связать из этой пряжи</p>
            {isMatchesLocked ? (
              <>
                <button type="button" className="log-usage-manual-add-btn" onClick={handleOpenManualEntry}>
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

          {error && <p className="log-usage-error">{error}</p>}
        </div>

        <div className="log-usage-footer">
          <button type="button" className="btn log-usage-next-btn" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" className="btn log-usage-close-btn" onClick={onClose} disabled={isSubmitting}>
            Закрыть
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
