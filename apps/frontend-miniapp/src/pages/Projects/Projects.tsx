import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { fetchProjects, deleteProject, ProjectListItem, ProjectStatus } from '../../api/projectsApi';
import { Footer } from '../../components/Footer/Footer';
import { AddProjectModal } from './AddProjectModal';
import { SwipeableProjectCard } from './SwipeableProjectCard';
import { ProjectCardDesktop } from './ProjectCardDesktop';
import { DeleteProjectConfirmModal } from './DeleteProjectConfirmModal';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { STATUS_LABEL, STATUS_COLOR, STATUS_ICON, STATUS_ORDER } from './projectStatus';
import '../Stash/Stash.css';
import './Projects.css';
import './AddProjectModal.css';

// Десктопная сводка (Figma node-id=1637:21739) — "≈N мес." и "≈N кг",
// тот же формат, что formatWeight в Stash.tsx, но локально здесь, т.к.
// общего места для подобных хелперов в проекте пока нет (как и там).
function formatYarnWeight(grams: number): string {
  if (grams >= 1000) {
    const kg = Math.round(grams / 100) / 10;
    return `≈${kg} кг`;
  }
  return `≈${grams} г`;
}

function formatDuration(days: number): string {
  const months = Math.round(days / 30);
  return months >= 1 ? `≈${months} мес.` : `≈${days} дн.`;
}

// Figma node-id=1443:13724/1360:22220 — toggle-фильтры по статусу (не
// радио-группа с "Все"): каждый переключается независимо, пустое
// множество = показать все проекты. Выбранный заливается цветом статуса и
// показывает счётчик найденного, невыбранные остаются пустыми (border).
// Единый источник лейбла/цвета/иконки — projectStatus.ts, тот же, что и на
// остальных страницах раздела (карточка проекта, форма создания/
// редактирования, список).
const STATUS_FILTERS = STATUS_ORDER.map((value) => ({
  value,
  label: STATUS_LABEL[value],
  icon: STATUS_ICON[value],
  color: STATUS_COLOR[value],
}));

export const Projects: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [total, setTotal] = useState(0);
  // Сводка для шапки (донат + карточка года) — стабильная, не зависит от
  // текущего фильтра/поиска, см. комментарий у statusCounts в projectsApi.ts.
  const [statusCounts, setStatusCounts] = useState<Partial<Record<ProjectStatus, number>>>({});
  const [completedThisYear, setCompletedThisYear] = useState(0);
  // Десктопная сводка (Figma node-id=1637:21739) — та же "стабильная
  // сводка" природа, что statusCounts/completedThisYear выше.
  const [avgDurationDays, setAvgDurationDays] = useState<number | null>(null);
  const [totalYarnUsedG, setTotalYarnUsedG] = useState(0);
  const [page, setPage] = useState(1);
  // loading — только самая первая загрузка страницы (весь UI ещё не
  // отрисован, нечего сохранять). Смена фильтра/поиска — это уже
  // isRefetching: список карточек ниже обновляется в фоне, а счётчик/
  // поиск/фильтры остаются на месте — иначе клик по фильтру статуса
  // заставлял весь верх страницы схлопываться в "Загрузка проектов...".
  const [loading, setLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Один активный статус-фильтр за раз (сервер фильтрует по одному status) —
  // повторный клик по уже активному снимает фильтр целиком.
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | null>(null);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const isDesktop = useIsDesktop();
  // Удаление прямо из списка — только на десктопе (Figma node-id=1637:21739),
  // на мобиле удаление только с карточки проекта (ProjectDetails.tsx).
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const hasMore = items.length < total;
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadPage = useCallback(async (pageToLoad: number, search: string, status: ProjectStatus | null) => {
    try {
      const data = await fetchProjects({ page: pageToLoad, q: search || undefined, status: status ?? undefined });
      setItems((prev) => (pageToLoad === 1 ? data.items : [...prev, ...data.items]));
      setTotal(data.total);
      setStatusCounts(data.statusCounts);
      setCompletedThisYear(data.completedThisYear);
      setAvgDurationDays(data.avgDurationDays);
      setTotalYarnUsedG(data.totalYarnUsedG);
      setPage(data.page);
      setError(null);
    } catch (err) {
      console.error('[Projects] loadPage failed:', err);
      setError('Не удалось загрузить проекты. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
      setIsRefetching(false);
      setIsFetchingMore(false);
    }
  }, []);

  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      setLoading(true);
    } else {
      setIsRefetching(true);
    }
    loadPage(1, debouncedSearch, statusFilter);
  }, [loadPage, debouncedSearch, statusFilter]);

  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isFetchingMore) {
        setIsFetchingMore(true);
        loadPage(page + 1, debouncedSearch, statusFilter);
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, isFetchingMore, page, debouncedSearch, statusFilter, loadPage]);

  const handleToggleStatus = (status: ProjectStatus) => {
    setStatusFilter((prev) => (prev === status ? null : status));
  };

  const handleConfirmDeleteProject = async (returnYarnToStash: boolean) => {
    if (!deleteTarget || isDeletingProject) return;
    setIsDeletingProject(true);
    try {
      await deleteProject(deleteTarget.id, returnYarnToStash);
      setItems((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setTotal((prev) => Math.max(0, prev - 1));
      setDeleteTarget(null);
    } catch (err) {
      console.error('[Projects] handleConfirmDeleteProject failed:', err);
      setError('Не удалось удалить проект.');
    } finally {
      setIsDeletingProject(false);
    }
  };

  // Донат в шапке (Figma node-id=1700:22637) — сегменты по реальным
  // пропорциям statusCounts, не запечённые проценты из макета (там под
  // конкретный мокап, 31 проект). conic-gradient строится один раз на
  // рендер — дешёво, список статусов короткий (4).
  const donutTotal = STATUS_ORDER.reduce((sum, s) => sum + (statusCounts[s] ?? 0), 0);
  let donutAcc = 0;
  const donutStops = donutTotal > 0
    ? STATUS_ORDER.map((s) => {
        const count = statusCounts[s] ?? 0;
        const from = (donutAcc / donutTotal) * 360;
        donutAcc += count;
        const to = (donutAcc / donutTotal) * 360;
        return `${STATUS_COLOR[s]} ${from}deg ${to}deg`;
      }).join(', ')
    : '#e5e5e5 0deg 360deg';

  return (
    <div className="stash-container">
      <div className="stash-header">
        <h1 className="stash-title">Проекты</h1>
      </div>

      {!loading && (
        <div className="stash-desktop-top-row">
          <p className="stash-breadcrumb">Проекты</p>
          <button type="button" className="stash-add-chip" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={20} strokeWidth={1.5} />
            Добавить проект
          </button>
        </div>
      )}

      {loading ? (
        <p className="loading-message">Загрузка проектов...</p>
      ) : (
        <>
          {error && <p className="stash-error">{error}</p>}

          <div className="projects-summary-row">
            <div className="projects-summary-donut-block">
              <div className="projects-donut" style={{ background: `conic-gradient(${donutStops})` }}>
                <div className="projects-donut-hole">
                  <p className="projects-donut-total">{donutTotal}</p>
                </div>
              </div>
              <div className="projects-legend">
                {STATUS_ORDER.map((s) => (
                  <div key={s} className="projects-legend-item">
                    <span className="projects-legend-dot" style={{ background: STATUS_COLOR[s] }} />
                    <span className="projects-legend-label">{STATUS_LABEL[s]}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Мобильная компактная карточка — скрыта на десктопе, там тот
                же стат переезжает в один ряд с двумя новыми ниже (Figma
                node-id=1637:21739), не дублируется. */}
            <div className="projects-year-card projects-year-card--mobile-only">
              <p className="projects-year-value">{completedThisYear}</p>
              <p className="projects-year-label">в {new Date().getFullYear()} году</p>
            </div>
            {avgDurationDays != null && (
              <div className="projects-year-card projects-year-card--desktop-only">
                <p className="projects-year-value">{formatDuration(avgDurationDays)}</p>
                <p className="projects-year-label">средний срок проекта</p>
              </div>
            )}
            <div className="projects-year-card projects-year-card--desktop-only">
              <p className="projects-year-value">{completedThisYear}</p>
              <p className="projects-year-label">завершено в {new Date().getFullYear()} году</p>
            </div>
            <div className="projects-year-card projects-year-card--desktop-only">
              <p className="projects-year-value">{formatYarnWeight(totalYarnUsedG)}</p>
              <p className="projects-year-label">пряжи связано</p>
            </div>
          </div>

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

          <div className="projects-status-filter-row">
            <button
              type="button"
              className={`projects-status-filter-chip projects-status-filter-chip--all${statusFilter === null ? ' projects-status-filter-chip--active' : ''}`}
              style={statusFilter === null ? { background: '#1d1c1c', borderColor: '#1d1c1c', color: '#ffffff' } : undefined}
              onClick={() => setStatusFilter(null)}
            >
              Все
            </button>
            {STATUS_FILTERS.map((f) => {
              const isActive = statusFilter === f.value;
              const Icon = f.icon;
              return (
                <button
                  key={f.value}
                  type="button"
                  className={`projects-status-filter-chip${isActive ? ' projects-status-filter-chip--active' : ''}`}
                  style={isActive ? { background: f.color, borderColor: f.color, color: '#ffffff' } : undefined}
                  onClick={() => handleToggleStatus(f.value)}
                >
                  <span className="projects-status-filter-icon-wrap">
                    <Icon size={13} strokeWidth={1.5} color={isActive ? '#ffffff' : f.color} />
                  </span>
                  <span>{f.label}</span>
                  {isActive && <span className="projects-status-filter-count">{total}</span>}
                </button>
              );
            })}
          </div>

          {/* Место под строку всегда зарезервировано (visibility, не
              условный рендер) — иначе появление/исчезновение фильтра
              статуса двигало бы весь список карточек по вертикали. */}
          <p className={`projects-found-count${statusFilter ? '' : ' projects-found-count--hidden'}`}>
            найдено проектов: {total}
          </p>

          <button type="button" className="plus-add-button" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
            Добавить проект
          </button>
        </>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="stash-empty-state">
          {debouncedSearch ? (
            <>Ничего не найдено по запросу «{debouncedSearch}».</>
          ) : (
            <>Пока здесь пусто.<br />Создайте свой первый проект, чтобы начать!</>
          )}
        </p>
      )}

      {items.length > 0 && (
        <>
          {isDesktop ? (
            <div className={`projects-grid-desktop${isRefetching ? ' projects-grid--refetching' : ''}`}>
              {items.map((item) => (
                <ProjectCardDesktop
                  key={item.id}
                  item={item}
                  onOpen={() => navigate(`/projects/${item.id}`)}
                  onRequestDelete={() => setDeleteTarget(item)}
                />
              ))}
            </div>
          ) : (
            <div className={`projects-grid${isRefetching ? ' projects-grid--refetching' : ''}`}>
              {items.map((item) => (
                <SwipeableProjectCard
                  key={item.id}
                  item={item}
                  onOpen={() => navigate(`/projects/${item.id}`)}
                />
              ))}
            </div>
          )}
          {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          {isFetchingMore && <p className="loading-message">Загрузка...</p>}
        </>
      )}

      <Footer />

      <DeleteProjectConfirmModal
        isOpen={!!deleteTarget}
        projectTitle={deleteTarget?.title ?? ''}
        hasYarnUsages={deleteTarget?.hasYarnUsages ?? false}
        isDeleting={isDeletingProject}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDeleteProject}
      />

      <AddProjectModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onCreated={() => {
          setIsAddModalOpen(false);
          loadPage(1, debouncedSearch, statusFilter);
        }}
        onLimitReached={() => {
          setIsAddModalOpen(false);
          setIsPaywallOpen(true);
        }}
      />

      <StashPaywallBanner
        isOpen={isPaywallOpen}
        reason="project-limit"
        freeLimit={5}
        onClose={() => setIsPaywallOpen(false)}
      />
    </div>
  );
};
