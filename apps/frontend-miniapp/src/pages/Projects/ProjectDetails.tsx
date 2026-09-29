import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, ChevronDown } from 'lucide-react';
import { STATUS_LABEL, STATUS_COLOR, STATUS_ICON, STATUS_ORDER } from './projectStatus';
import {
  fetchProjectById,
  deleteProject,
  addProjectYarn,
  removeProjectYarn,
  deleteProjectSwatch,
  updateProject,
  ProjectDetail as ProjectDetailType,
  ProjectDocument,
  ProjectSwatch,
  ProjectStatus,
} from '../../api/projectsApi';
import { fetchStashSkeins, StashSkein } from '../../api/stashApi';
import { canGoBackInApp } from '../../hooks/useNavigationDepth';
import { Footer } from '../../components/Footer/Footer';
import { SwipeToDelete } from '../../components/SwipeToDelete/SwipeToDelete';
import { AddProjectModal } from './AddProjectModal';
import { CompleteProjectWizard } from './CompleteProjectWizard';
import { ProjectSwatchModal } from './ProjectSwatchModal';
import { DeleteProjectConfirmModal } from './DeleteProjectConfirmModal';
import { DeleteConfirmModal } from '../../components/DeleteConfirmModal/DeleteConfirmModal';
import { AddYarnModal } from '../Stash/AddYarnModal';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';
import { StashImageCarousel } from '../StashSkeinDetails/StashImageCarousel';
import { HeaderActionsMenu } from '../../components/HeaderActionsMenu/HeaderActionsMenu';
import arrowLeftIcon from '../../assets/arrow-left.svg';
import yarnPlaceholder from '../../assets/stash/yarn-placeholder.png';
import swatchPlaceholder from '../../assets/stash/swatchPlaceholder.svg';
import projectPlaceholder from '../../components/TabBar/icons/project1.svg';
import '../StashSkeinDetails/StashSkeinDetails.css';
import './AddProjectModal.css';

const PdfViewerModal = lazy(() => import('./PdfViewerModal').then((m) => ({ default: m.PdfViewerModal })));

export const ProjectDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCompleteWizardOpen, setIsCompleteWizardOpen] = useState(false);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);

  const [yarnQuery, setYarnQuery] = useState('');
  const [yarnResults, setYarnResults] = useState<StashSkein[]>([]);
  const [isYarnSearchOpen, setIsYarnSearchOpen] = useState(false);
  const [isSearchingYarn, setIsSearchingYarn] = useState(false);
  // Тот же паттерн, что в AddProjectModal.tsx: список результатов скрыт,
  // если поле потеряло фокус без ввода — иначе список остаётся видимым
  // навсегда после первого открытия формы поиска (isYarnSearchOpen сам по
  // себе про показ ИНПУТА, не про показ списка под ним).
  const [isYarnFieldFocused, setIsYarnFieldFocused] = useState(false);
  const [isAddYarnOpen, setIsAddYarnOpen] = useState(false);
  const [isYarnLimitPaywallOpen, setIsYarnLimitPaywallOpen] = useState(false);
  const [openSwipeYarnId, setOpenSwipeYarnId] = useState<string | null>(null);

  const [isAddSwatchOpen, setIsAddSwatchOpen] = useState(false);
  const [editSwatchTarget, setEditSwatchTarget] = useState<ProjectSwatch | null>(null);
  const [lastEditSwatch, setLastEditSwatch] = useState<ProjectSwatch | null>(null);
  const [openSwipeSwatchId, setOpenSwipeSwatchId] = useState<string | null>(null);
  const [deleteSwatchTarget, setDeleteSwatchTarget] = useState<ProjectSwatch | null>(null);
  const [isDeletingSwatch, setIsDeletingSwatch] = useState(false);

  const [isDeleteProjectOpen, setIsDeleteProjectOpen] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const [viewingDocument, setViewingDocument] = useState<ProjectDocument | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProjectById(id);
      setProject(data);
    } catch {
      setError('Не удалось загрузить проект.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Список запасов показывается сразу по фокусу на поле (не дожидаясь
  // ввода первых символов — пустой search отдаёт первую страницу всех
  // мотков), тот же паттерн, что в AddProjectModal.tsx.
  useEffect(() => {
    if (!isYarnFieldFocused && yarnQuery.trim().length === 0) {
      setYarnResults([]);
      setIsSearchingYarn(false);
      return;
    }
    setIsSearchingYarn(true);
    const timer = setTimeout(() => {
      fetchStashSkeins({ search: yarnQuery.trim() || undefined })
        .then((res) => setYarnResults(res.items))
        .catch(() => setYarnResults([]))
        .finally(() => setIsSearchingYarn(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [yarnQuery, isYarnFieldFocused]);

  const handleBack = () => {
    if (canGoBackInApp()) navigate(-1);
    else navigate('/projects');
  };

  if (loading) {
    return <p className="loading-message">Загрузка...</p>;
  }

  if (error || !project) {
    return (
      <div className="stash-details-container">
        <button className="back-button" onClick={handleBack}>
          <img src={arrowLeftIcon} alt="Back" className="back-button-icon" />
          Назад
        </button>
        <p className="stash-details-error">{error || 'Проект не найден'}</p>
      </div>
    );
  }

  const handlePickStatus = async (status: ProjectStatus) => {
    setIsStatusMenuOpen(false);
    if (status === project.status) return;
    if (status === 'COMPLETED') {
      setIsCompleteWizardOpen(true);
      return;
    }
    try {
      const updated = await updateProject(project.id, { status });
      setProject(updated);
    } catch {
      setError('Не удалось изменить статус проекта.');
    }
  };

  const handlePickYarn = async (skein: StashSkein) => {
    if (project.yarns.some((y) => y.skeinId === skein.id)) return;
    setYarnQuery('');
    setYarnResults([]);
    setIsYarnSearchOpen(false);
    try {
      await addProjectYarn(project.id, skein.id);
      await load();
    } catch {
      setError('Не удалось привязать пряжу.');
    }
  };

  // Пряжи не нашлось в хранилище по поиску — создаём новую прямо отсюда и
  // сразу привязываем к проекту, тем же путём, что и выбор из результатов
  // поиска (handlePickYarn).
  const handleYarnCreated = (skein: StashSkein) => {
    setIsAddYarnOpen(false);
    handlePickYarn(skein);
  };

  const handleRemoveYarn = async (skeinId: string) => {
    try {
      await removeProjectYarn(project.id, skeinId);
      await load();
    } catch {
      setError('Не удалось отвязать пряжу.');
    }
  };

  const handleConfirmDeleteSwatch = async () => {
    if (!deleteSwatchTarget || isDeletingSwatch) return;
    setIsDeletingSwatch(true);
    try {
      await deleteProjectSwatch(deleteSwatchTarget.id);
      setProject((prev) => prev && { ...prev, swatches: prev.swatches.filter((s) => s.id !== deleteSwatchTarget.id) });
      setDeleteSwatchTarget(null);
      setOpenSwipeSwatchId(null);
    } catch {
      setError('Не удалось удалить образец.');
    } finally {
      setIsDeletingSwatch(false);
    }
  };

  const handleConfirmDeleteProject = async (returnYarnToStash: boolean) => {
    if (isDeletingProject) return;
    setIsDeletingProject(true);
    try {
      await deleteProject(project.id, returnYarnToStash);
      navigate('/projects');
    } catch {
      setError('Не удалось удалить проект.');
      setIsDeletingProject(false);
    }
  };

  const heroImages = project.finishedPhotos.length > 0 ? project.finishedPhotos : project.images;
  const firstPattern = project.patterns[0];

  return (
    <div className="stash-details-container">
      <div className="stash-details-header">
        <button className="back-button" onClick={handleBack}>
          <img src={arrowLeftIcon} alt="Back" className="back-button-icon" />
          Назад
        </button>
        <HeaderActionsMenu onEdit={() => setIsEditOpen(true)} onDelete={() => setIsDeleteProjectOpen(true)} />
      </div>

      <div className="stash-details-image-wrapper">
        <div className="stash-details-image-container">
          {heroImages.length > 0 ? (
            <StashImageCarousel images={heroImages} alt={project.title} />
          ) : (
            <div className="stash-details-image stash-details-image-placeholder">
              <img src={projectPlaceholder} alt="" />
            </div>
          )}
        </div>
      </div>

      <div className="stash-details-info add-details-info">
        <h1 className="stash-details-name">{project.title}</h1>

        <div className="stash-details-status-row">
          <p className="add-project-section-title">Статус</p>
          <div className="add-project-status-dropdown-wrap">
            {(() => {
              const Icon = STATUS_ICON[project.status]; return (
                <button
                  type="button"
                  className="status-badge"
                  style={{ background: STATUS_COLOR[project.status] }}
                  onClick={() => setIsStatusMenuOpen((v) => !v)}
                >
                  <span className="projects-status-icon-wrap">
                    <Icon size={13} strokeWidth={1.5} color="#ffffff" />
                  </span>
                  {STATUS_LABEL[project.status]}
                </button>
              );
            })()}
            <ChevronDown size={24} strokeWidth={1.5} onClick={() => setIsStatusMenuOpen((v) => !v)} style={{ cursor: 'pointer' }} />
            {isStatusMenuOpen && (
              <div className="status-dropdown-list">
                {STATUS_ORDER
                  .filter((s) => s !== project.status)
                  .map((s) => {
                    const Icon = STATUS_ICON[s];
                    return (
                      <button
                        key={s}
                        type="button"
                        className="status-badge"
                        style={{ background: STATUS_COLOR[s] }}
                        onClick={() => handlePickStatus(s)}
                      >
                        <span className="projects-status-icon-wrap">
                          <Icon size={13} strokeWidth={1.5} color="#ffffff" />
                        </span>
                        {STATUS_LABEL[s]}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        <div className="stash-details-dates-row">
          <div className="stash-details-date-col add-details-date-col">
            <p className="stash-details-date-label">Начало</p>
            <p className="stash-details-date-value">{new Date(project.startedAt).toLocaleDateString('ru-RU')}</p>
          </div>
          <div className="stash-details-date-col add-details-date-col stash-details-date-col--end">
            <p className="stash-details-date-label">Завершено</p>
            <p className="stash-details-date-value">{project.completedAt ? new Date(project.completedAt).toLocaleDateString('ru-RU') : '__.__.____'}</p>
          </div>
        </div>

        {firstPattern && (
          <p className="stash-details-tag-row"><span className="stash-details-tag-label">Описание:</span> <span className="stash-details-tag-value">#{firstPattern.patternTitleSnapshot}</span></p>
        )}
        {!firstPattern && project.manualDescription && (
          <p className="stash-details-tag-row"><span className="stash-details-tag-label">Описание:</span> <span className="stash-details-tag-value">{project.manualDescription}</span></p>
        )}
        {firstPattern && (
          <p className="stash-details-tag-row"><span className="stash-details-tag-label">Автор:</span> <span className="stash-details-tag-value">{firstPattern.patternAuthorSnapshot}</span></p>
        )}
        {!firstPattern && project.manualAuthor && (
          <p className="stash-details-tag-row"><span className="stash-details-tag-label">Автор:</span> <span className="stash-details-tag-value">{project.manualAuthor}</span></p>
        )}
      </div>

      <div className="stash-details-usages">
        <p className="stash-details-section-title">Пряжа</p>
        {project.yarns.map((y) => (
          <SwipeToDelete
            key={y.id}
            isOpen={openSwipeYarnId === y.id}
            onSwipeOpen={() => setOpenSwipeYarnId(y.id)}
            onSwipeClose={() => setOpenSwipeYarnId((cur) => (cur === y.id ? null : cur))}
            onTap={() => { if (y.skeinId) navigate(`/stash/${y.skeinId}`); }}
            onRequestDelete={() => y.skeinId && handleRemoveYarn(y.skeinId)}
            cardClassName="stash-usage-card"
          >
            <div className="stash-usage-image">
              {y.skein && y.skein.images.length > 0 ? (
                <img src={y.skein.images[0]} alt="" className="stash-usage-image" />
              ) : (
                <div className="stash-usage-image-placeholder">
                  <img src={yarnPlaceholder} alt="" />
                </div>
              )}
            </div>
            {/* Типографика — та же, что у YarnCardCompact в форме
                создания/редактирования (.add-project-yarn-card-*, сверено
                с точным кодом Figma node-id=1470:27049) — единый стиль
                карточки пряжи во всех местах, где она встречается. */}
            <div className="stash-usage-body add-project-yarn-card-body">
              <p className="add-project-yarn-card-title">{y.yarnNameSnapshot}</p>
              {y.brandSnapshot && <p className="add-project-yarn-card-meta"><b>Бренд:</b> {y.brandSnapshot}</p>}
              {y.amountAtCompletionG != null && (
                <p className="add-project-yarn-card-meta"><b>Расход:</b> {y.amountAtCompletionG} г</p>
              )}
              {!y.skeinId && <p className="add-project-yarn-card-meta">Моток удалён из хранилища</p>}
            </div>
          </SwipeToDelete>
        ))}

        {isYarnSearchOpen ? (
          <div className="add-project-field">
            <input
              className="add-project-input"
              value={yarnQuery}
              placeholder="Найдите моток в хранилище"
              onChange={(e) => setYarnQuery(e.target.value)}
              onFocus={() => setIsYarnFieldFocused(true)}
              onBlur={() => setIsYarnFieldFocused(false)}
              autoFocus
            />
            {isSearchingYarn && <p className="loading-message">Загрузка...</p>}
            {!isSearchingYarn && yarnResults.length > 0 && (
              <div className="add-project-cards-vertical">
                {yarnResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="add-project-card-row"
                    // onMouseDown, не onClick — onBlur инпута (выше)
                    // срабатывает раньше onClick при клике по кнопке (blur
                    // — часть смены фокуса на mousedown), список успел бы
                    // скрыться до того, как клик дойдёт до кнопки.
                    onMouseDown={(e) => { e.preventDefault(); handlePickYarn(s); }}
                  >
                    <div className="add-project-card-row-body">
                      <p className="add-project-card-row-title">{s.yarnNameSnapshot}</p>
                      <p className="add-project-card-row-meta">Остаток: {s.currentWeightG} г</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!isSearchingYarn && yarnResults.length === 0 && (isYarnFieldFocused || yarnQuery.trim()) && (
              <>
                <p className="add-project-empty-text">
                  {yarnQuery.trim() ? 'Ничего не найдено' : 'В хранилище пока пусто'}
                </p>
                <button type="button" className="plus-add-button" onClick={() => setIsAddYarnOpen(true)}>
                  <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
                  Добавить пряжу
                </button>
              </>
            )}
          </div>
        ) : (
          <button type="button" className="plus-add-button" onClick={() => setIsYarnSearchOpen(true)}>
            <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
            Привязать пряжу
          </button>
        )}
      </div>

      <div className="stash-details-swatches">
        <p className="stash-details-section-title">Образец</p>
        {project.swatches.map((swatch) => (
          <SwipeToDelete
            key={swatch.id}
            isOpen={openSwipeSwatchId === swatch.id}
            onSwipeOpen={() => setOpenSwipeSwatchId(swatch.id)}
            onSwipeClose={() => setOpenSwipeSwatchId((cur) => (cur === swatch.id ? null : cur))}
            onTap={() => { }}
            onRequestDelete={() => setDeleteSwatchTarget(swatch)}
            onRequestEdit={() => { setEditSwatchTarget(swatch); setLastEditSwatch(swatch); }}
            cardClassName="stash-swatch-block"
          >
            <div className="stash-swatch-image">
              {swatch.images.length > 0 ? (
                <StashImageCarousel images={swatch.images} alt="Образец" classPrefix="stash-swatch-image" />
              ) : (
                <div className="stash-swatch-image-placeholder">
                  <img src={swatchPlaceholder} alt="" />
                </div>
              )}
            </div>
            <div className="stash-swatch-body">
              {swatch.needleSizeRaw && <p className="stash-details-row"><b>Спицы:</b> {swatch.needleSizeRaw}</p>}
              {swatch.strandsCount != null && <p className="stash-details-row"><b>Количество нитей:</b> {swatch.strandsCount}</p>}
              {(swatch.densityStitchesBefore || swatch.densityRowsBefore) && (
                <p className="stash-details-row">
                  <b>До ВТО:</b> {swatch.densityStitchesBefore ?? '—'} п. х {swatch.densityRowsBefore ?? '—'} р.
                </p>
              )}
              {(swatch.densityStitchesAfter || swatch.densityRowsAfter) && (
                <p className="stash-details-row">
                  <b>После ВТО:</b> {swatch.densityStitchesAfter ?? '—'} п. х {swatch.densityRowsAfter ?? '—'} р.
                </p>
              )}
            </div>
          </SwipeToDelete>
        ))}
        <button type="button" className="plus-add-button" onClick={() => setIsAddSwatchOpen(true)}>
          <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
          Добавить образец
        </button>
      </div>

      {project.instruments.length > 0 && (
        <div className="stash-details-info">
          <p className="stash-details-section-title">Инструмент</p>
          <p className="stash-details-row">
            {project.instruments
              .map((i) => (i.sizeMm != null ? `${i.instrument.name} ${String(i.sizeMm).replace('.', ',')} мм` : i.instrument.name))
              .join(', ')}
          </p>
        </div>
      )}

      {project.documents.length > 0 && (
        <div className="add-project-section">
          <p className="stash-details-section-title">Описание, файл</p>
          {project.documents.map((doc) => (
            <div key={doc.id} className="add-project-pdf-row">
              <button type="button" className="add-project-pdf-link" onClick={() => setViewingDocument(doc)}>
                #{doc.originalFileName}
              </button>
            </div>
          ))}
        </div>
      )}

      {project.referencePhotos.length > 0 && (
        <div className="add-project-section">
          <p className="stash-details-section-title">Референс</p>
          <div className="add-project-photos">
            {project.referencePhotos.map((url) => (
              <div key={url} className="add-project-photo-thumb add-project-photo-thumb-referencePhotos">
                <img src={url} alt="" />
              </div>
            ))}
          </div>
        </div>
      )}

      {project.note && (
        <div className="stash-details-notes">
          <p className="stash-details-section-title">Заметки</p>
          <p className="stash-notes-text">{project.note}</p>
        </div>
      )}

      <Footer />

      <AddProjectModal
        isOpen={isEditOpen}
        project={project}
        onClose={() => setIsEditOpen(false)}
        onUpdated={(updated) => {
          setIsEditOpen(false);
          setProject(updated);
        }}
        onRequestComplete={() => {
          setIsEditOpen(false);
          setIsCompleteWizardOpen(true);
        }}
      />

      <CompleteProjectWizard
        isOpen={isCompleteWizardOpen}
        project={project}
        onClose={() => setIsCompleteWizardOpen(false)}
        onCompleted={(updated) => {
          setIsCompleteWizardOpen(false);
          setProject(updated);
        }}
      />

      <ProjectSwatchModal
        isOpen={isAddSwatchOpen}
        projectId={project.id}
        onClose={() => setIsAddSwatchOpen(false)}
        onSaved={() => {
          setIsAddSwatchOpen(false);
          load();
        }}
      />

      {lastEditSwatch && (
        <ProjectSwatchModal
          isOpen={!!editSwatchTarget}
          projectId={project.id}
          swatch={lastEditSwatch}
          onClose={() => setEditSwatchTarget(null)}
          onSaved={() => {
            setEditSwatchTarget(null);
            load();
          }}
        />
      )}

      <DeleteConfirmModal
        isOpen={!!deleteSwatchTarget}
        title="Удалить образец?"
        text="Образец будет удалён без возможности восстановить."
        isDeleting={isDeletingSwatch}
        onCancel={() => setDeleteSwatchTarget(null)}
        onConfirm={handleConfirmDeleteSwatch}
      />

      <DeleteProjectConfirmModal
        isOpen={isDeleteProjectOpen}
        projectTitle={project.title}
        hasYarnUsages={project.usages.length > 0}
        isDeleting={isDeletingProject}
        onCancel={() => setIsDeleteProjectOpen(false)}
        onConfirm={handleConfirmDeleteProject}
      />

      <AddYarnModal
        isOpen={isAddYarnOpen}
        initialNameQuery={yarnQuery}
        onClose={() => setIsAddYarnOpen(false)}
        onCreated={handleYarnCreated}
        onLimitReached={() => {
          setIsAddYarnOpen(false);
          setIsYarnLimitPaywallOpen(true);
        }}
      />

      <StashPaywallBanner
        isOpen={isYarnLimitPaywallOpen}
        reason="limit"
        freeLimit={10}
        onClose={() => setIsYarnLimitPaywallOpen(false)}
      />

      {viewingDocument && (
        <Suspense fallback={null}>
          <PdfViewerModal
            isOpen={!!viewingDocument}
            documentId={viewingDocument.id}
            fileName={viewingDocument.originalFileName}
            onClose={() => setViewingDocument(null)}
          />
        </Suspense>
      )}
    </div>
  );
};
