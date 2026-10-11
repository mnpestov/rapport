import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Lock } from 'lucide-react';
import { fetchStashSkeins, deleteStashSkein, StashSkein } from '../../api/stashApi';
import { Footer } from '../../components/Footer/Footer';
import { AddYarnModal } from './AddYarnModal';
import { SwipeableStashCard } from './SwipeableStashCard';
import { StashCardDesktop } from './StashCardDesktop';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { DeleteConfirmModal } from '../../components/DeleteConfirmModal/DeleteConfirmModal';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';
import './Stash.css';

// Склонение "артикул" под число — тот же приём, что pluralizeProjects в
// Projects.tsx/pluralizeDays в ProjectDetails.tsx.
function pluralizeArticles(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'артикул';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'артикула';
  return 'артикулов';
}

function formatWeight(grams: number): string {
  if (grams >= 1000) {
    const kg = Math.floor(grams / 1000);
    const rest = grams % 1000;
    return rest > 0 ? `${kg} кг ${rest} г` : `${kg} кг`;
  }
  return `${grams} г`;
}

export const Stash: React.FC = () => {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [items, setItems] = useState<StashSkein[]>([]);
  const [total, setTotal] = useState(0);
  // Вес "в наличии" (сумма currentWeightG по всем моткам) — показывается как
  // "общий вес" в шапке хранилища. Раньше тут был totalWeightG (вес на
  // момент покупки, включая уже израсходованное) — по просьбе пользователя
  // "общий вес" должен отражать то, что реально есть в наличии сейчас.
  const [totalCurrentWeight, setTotalCurrentWeight] = useState(0);
  const [totalUsedWeight, setTotalUsedWeight] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // isInitialLoading: true только пока хранилище ещё ни разу не загружалось
  // (список пуст и ответ ещё не пришёл). При повторных запросах (поиск,
  // архив) остаётся false — старый список виден, интерфейс не скачет.
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StashSkein | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [isUnlimited, setIsUnlimited] = useState(true);
  const [freeLimit, setFreeLimit] = useState(10);
  const [totalSkeinCount, setTotalSkeinCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);

  const hasMore = items.length < total;
  const isLimitReached = !isUnlimited && totalSkeinCount >= freeLimit;
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadPage = useCallback(async (pageToLoad: number, search: string, archived: boolean) => {
    try {
      const data = await fetchStashSkeins({ page: pageToLoad, search: search || undefined, archived });
      setItems((prev) => (pageToLoad === 1 ? data.items : [...prev, ...data.items]));
      setTotal(data.total);
      setTotalCurrentWeight(data.totalCurrentWeightG);
      setTotalUsedWeight(data.totalUsedWeightG);
      setIsUnlimited(data.isUnlimited);
      setFreeLimit(data.freeLimit);
      setTotalSkeinCount(data.totalSkeinCount);
      setLowStockCount(data.lowStockCount);
      setPage(data.page);
      setError(null);
    } catch (err) {
      console.error('[Stash] loadPage failed:', err);
      setError('Не удалось загрузить хранилище пряжи. Попробуйте ещё раз.');
    } finally {
      setIsInitialLoading(false);
      setLoading(false);
      setIsFetchingMore(false);
    }
  }, []);

  useEffect(() => {
    // setLoading нужен только для guard'а инфинити-скролла (строка выше:
    // if (!hasMore || loading) return). НЕ показываем «Загрузка...» при
    // каждом поиске — для этого isInitialLoading, который не поднимается
    // повторно и не вызывает скачок интерфейса.
    setLoading(true);
    loadPage(1, debouncedSearch, showArchived);
  }, [loadPage, debouncedSearch, showArchived]);

  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isFetchingMore) {
        setIsFetchingMore(true);
        loadPage(page + 1, debouncedSearch, showArchived);
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, isFetchingMore, page, debouncedSearch, showArchived, loadPage]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteStashSkein(deleteTarget.id);
      setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setTotal((prev) => Math.max(0, prev - 1));
      // totalCurrentWeight — вес "в наличии" (currentWeightG), не
      // totalWeightG: удалённый моток убирает из остатка именно то, что у
      // него реально оставалось, а не весь вес на момент покупки.
      setTotalCurrentWeight((prev) => Math.max(0, prev - deleteTarget.currentWeightG));
      setTotalUsedWeight((prev) => Math.max(0, prev - (deleteTarget.totalWeightG - deleteTarget.currentWeightG)));
      setTotalSkeinCount((prev) => Math.max(0, prev - 1));
      setDeleteTarget(null);
      setOpenSwipeId(null);
    } catch (err) {
      console.error('[Stash] handleConfirmDelete failed:', err);
      setError('Не удалось удалить пряжу. Попробуйте ещё раз.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="stash-container">
        <div className="stash-header">
          <h1 className="stash-title">Пряжа</h1>
        </div>

        {/* Десктоп-шапка (Figma node-id=1651:21630): хлебная крошка + кнопка
          добавления, вместо мобильного centered-заголовка выше и кнопки
          внизу списка (обе скрыты на десктопе через CSS, см. Stash.css). */}
        {!isInitialLoading && (
          <div className="stash-desktop-top-row">
            <p className="stash-breadcrumb">Пряжа</p>
            {!showArchived && (
              isLimitReached ? (
                // <button type="button" className="stash-add-chip stash-add-chip--locked" onClick={() => setIsPaywallOpen(true)}>
                //   <Plus size={20} strokeWidth={1.5} />
                //   Добавить пряжу
                //   <Lock size={14} strokeWidth={1.5} />
                // </button>
                <button type="button" className="stash-add-chip stash-add-chip--locked" onClick={() => setIsPaywallOpen(true)}>
                  <Plus strokeWidth={1.5} />
                  Добавить пряжу
                  <Lock strokeWidth={1.5} />
                </button>
              ) : (
                // <button type="button" className="stash-add-chip" onClick={() => setIsAddModalOpen(true)}>
                //   <Plus size={20} strokeWidth={1.5} />
                //   Добавить пряжу
                // </button>
                <button type="button" className="stash-add-chip" onClick={() => setIsAddModalOpen(true)}>
                  <Plus strokeWidth={1.5} />
                  Добавить пряжу
                </button>
              )
            )}
          </div>
        )}

        {!isInitialLoading && (
          <div className="stash-summary-row">
            <div className="stash-summary-cell stash-summary-cell--total">
              <p className="stash-summary-value">{formatWeight(totalCurrentWeight)}</p>
              <p className="stash-summary-label">общий вес</p>
            </div>
            <div className="stash-summary-group-cell">
              <div className="stash-summary-cell stash-summary-cell--used">
                <p className="stash-summary-value">{formatWeight(totalUsedWeight)}</p>
                <p className="stash-summary-label">израсходовано</p>
              </div>
              <div className="stash-summary-cell stash-summary-cell--desktop-only">
                {/* total, не totalSkeinCount — тот стабильно считает ВСЕ
                  мотки (используется для лимита бесплатного тарифа,
                  isLimitReached), а эта ячейка должна показывать количество
                  именно на текущей вкладке: в наличии или в архиве. total
                  уже считается на бэкенде с фильтром по archived. */}
                <p className="stash-summary-value">{total}</p>
                <p className="stash-summary-label">{pluralizeArticles(total)}</p>
              </div>
              <div className="stash-summary-cell stash-summary-cell--desktop-only">
                <p className="stash-summary-value">{lowStockCount}</p>
                <p className="stash-summary-label">{pluralizeArticles(lowStockCount)} меньше 50 г</p>
              </div>
            </div>
          </div>
        )}

        {isInitialLoading && <p className="loading-message">Загрузка хранилища...</p>}
        {error && !isInitialLoading && <p className="stash-error">{error}</p>}

        <div className="stash-search-row">
          <div className="stash-search-input-wrapper">
            <Search size={14} strokeWidth={1.5} className="stash-search-icon" />
            <input
              type="text"
              className="stash-search-input"
              placeholder="Найти"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={`stash-tab${showArchived ? ' stash-tab--active' : ''}`}
            onClick={() => setShowArchived((v) => !v)}
          >
            Архив
          </button>
        </div>

        {!isInitialLoading && !error && (
          <>
            <p className="stash-count">Всего артикулов: {total}</p>
            {!showArchived && (
              isLimitReached ? (
                <button type="button" className="stash-add-button stash-add-button--locked" onClick={() => setIsPaywallOpen(true)}>
                  <Plus size={32} strokeWidth={1} className="stash-add-button-plus" />
                  Добавить пряжу
                  <Lock size={16} strokeWidth={1.5} className="stash-add-button-lock" />
                </button>
              ) : (
                <button type="button" className="stash-add-button" onClick={() => setIsAddModalOpen(true)}>
                  <Plus size={32} strokeWidth={1} className="stash-add-button-plus" />
                  Добавить пряжу
                </button>
              )
            )}
          </>
        )}

        {!isInitialLoading && !error && items.length === 0 && (
          <p className="stash-empty-state">
            {showArchived ? (
              <>В архиве пока пусто.<br />Сюда попадёт пряжа с нулевым остатком.</>
            ) : debouncedSearch ? (
              <>Ничего не найдено по запросу «{debouncedSearch}».</>
            ) : (
              <>Здесь будет храниться вся ваша пряжа.<br />Добавьте первый артикул, чтобы начать</>
            )}
          </p>
        )}

        {items.length > 0 && (
          <>
            {isDesktop ? (
              <div className="stash-grid-desktop">
                {items.map((item) => (
                  <StashCardDesktop
                    key={item.id}
                    item={item}
                    onOpen={() => navigate(`/stash/${item.id}`)}
                    onRequestDelete={() => setDeleteTarget(item)}
                  />
                ))}
              </div>
            ) : (
              <div className="stash-list">
                {items.map((item) => (
                  <SwipeableStashCard
                    key={item.id}
                    item={item}
                    isOpen={openSwipeId === item.id}
                    onOpen={() => navigate(`/stash/${item.id}`)}
                    onSwipeOpen={() => setOpenSwipeId(item.id)}
                    onSwipeClose={() => setOpenSwipeId((cur) => (cur === item.id ? null : cur))}
                    onRequestDelete={() => setDeleteTarget(item)}
                  />
                ))}
              </div>
            )}
            {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
            {isFetchingMore && <p className="loading-message">Загрузка...</p>}
          </>
        )}

        {/* <Footer /> */}

        <AddYarnModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onCreated={(skein) => {
            setIsAddModalOpen(false);
            setItems((prev) => [skein, ...prev]);
            setTotal((prev) => prev + 1);
            // У только что созданного мотка currentWeightG равен totalWeightG
            // (ничего ещё не списано) — пишем явно верное поле для ясности.
            setTotalCurrentWeight((prev) => prev + skein.currentWeightG);
            setTotalSkeinCount((prev) => prev + 1);
          }}
          onLimitReached={() => {
            setIsAddModalOpen(false);
            setIsPaywallOpen(true);
          }}
        />

        <DeleteConfirmModal
          isOpen={!!deleteTarget}
          title="Удалить пряжу?"
          text={`«${deleteTarget?.yarnNameSnapshot ?? ''}» будет удалена из хранилища без возможности восстановить.`}
          isDeleting={isDeleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />

        <StashPaywallBanner
          isOpen={isPaywallOpen}
          reason="limit"
          freeLimit={freeLimit}
          onClose={() => setIsPaywallOpen(false)}
        />
      </div>
      <Footer />
    </>
  );
};
