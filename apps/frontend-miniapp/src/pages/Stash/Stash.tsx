import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Lock } from 'lucide-react';
import { fetchStashSkeins, deleteStashSkein, StashSkein } from '../../api/stashApi';
import { Footer } from '../../components/Footer/Footer';
import { AddYarnModal } from './AddYarnModal';
import { SwipeableStashCard } from './SwipeableStashCard';
import { DeleteConfirmModal } from '../../components/DeleteConfirmModal/DeleteConfirmModal';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';
import yarnIcon from '../../components/TabBar/icons/yarn-inactive.svg';
import './Stash.css';

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
  const [items, setItems] = useState<StashSkein[]>([]);
  const [total, setTotal] = useState(0);
  const [totalWeight, setTotalWeight] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
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
      setTotalWeight(data.totalCurrentWeightG);
      setIsUnlimited(data.isUnlimited);
      setFreeLimit(data.freeLimit);
      setTotalSkeinCount(data.totalSkeinCount);
      setPage(data.page);
      setError(null);
    } catch (e) {
      setError('Не удалось загрузить хранилище пряжи. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
      setIsFetchingMore(false);
    }
  }, []);

  useEffect(() => {
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
      setTotalWeight((prev) => Math.max(0, prev - deleteTarget.currentWeightG));
      setTotalSkeinCount((prev) => Math.max(0, prev - 1));
      setDeleteTarget(null);
      setOpenSwipeId(null);
    } catch {
      setError('Не удалось удалить пряжу. Попробуйте ещё раз.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="stash-container">
      <div className="stash-header">
        <h1 className="stash-title">Пряжа</h1>
      </div>

      {!loading && (
        <div className="stash-summary-row">
          <div className="stash-total-weight">
            <img src={yarnIcon} alt="" className="stash-total-weight-icon" />
            <div className="stash-total-weight-text">
              <p className="stash-total-weight-label">Общий вес пряжи:</p>
              <p className="stash-total-weight-value">{formatWeight(totalWeight)}</p>
            </div>
          </div>
          <button
            type="button"
            className={`stash-tab${showArchived ? ' stash-tab--active' : ''}`}
            onClick={() => setShowArchived((v) => !v)}
          >
            Архив
          </button>
        </div>
      )}

      {loading && <p className="loading-message">Загрузка хранилища...</p>}
      {error && !loading && <p className="stash-error">{error}</p>}

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
      </div>

      {!loading && !error && (
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

      {!loading && !error && items.length === 0 && (
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
          {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          {isFetchingMore && <p className="loading-message">Загрузка...</p>}
        </>
      )}

      <Footer />

      <AddYarnModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onCreated={(skein) => {
          setIsAddModalOpen(false);
          setItems((prev) => [skein, ...prev]);
          setTotal((prev) => prev + 1);
          setTotalWeight((prev) => prev + skein.currentWeightG);
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
  );
};
