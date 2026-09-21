import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock, Plus, SquarePen } from 'lucide-react';
import { fetchStashSkeinById, fetchStashMatches, undoStashUsage, deleteStashSwatch, suggestYarnFields, StashSkeinDetail, StashMatchItem, StashUsage, StashSwatch } from '../../api/stashApi';
import { canGoBackInApp } from '../../hooks/useNavigationDepth';
import { Footer } from '../../components/Footer/Footer';
import { SwipeToDelete } from '../../components/SwipeToDelete/SwipeToDelete';
import { DeleteConfirmModal } from '../../components/DeleteConfirmModal/DeleteConfirmModal';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';
import { AddSwatchModal } from './AddSwatchModal';
import { EditSkeinModal } from './EditSkeinModal';
import { EditSwatchModal } from './EditSwatchModal';
import { EditUsageModal } from './EditUsageModal';
import { LogUsageWizard } from './LogUsageWizard';
import { StashImageCarousel } from './StashImageCarousel';
import arrowLeftIcon from '../../assets/arrow-left.svg';
import yarnPlaceholder from '../../assets/stash/yarn-placeholder.png';
import projectPlaceholder from '../../components/TabBar/icons/project.svg';
import './StashSkeinDetails.css';

export const StashSkeinDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [skein, setSkein] = useState<StashSkeinDetail | null>(null);
  const [matches, setMatches] = useState<StashMatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddSwatchOpen, setIsAddSwatchOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isLogUsageOpen, setIsLogUsageOpen] = useState(false);
  const [openSwipeUsageId, setOpenSwipeUsageId] = useState<string | null>(null);
  const [deleteUsageTarget, setDeleteUsageTarget] = useState<StashUsage | null>(null);
  const [isDeletingUsage, setIsDeletingUsage] = useState(false);
  const [editUsageTarget, setEditUsageTarget] = useState<StashUsage | null>(null);
  // EditUsageModal остаётся смонтированной во время анимации закрытия
  // (useSheetTransition), поэтому usage для неё берём из ПОСЛЕДНЕГО
  // ненулевого значения editUsageTarget, а не из самого editUsageTarget —
  // обнуление на close иначе унесло бы с собой usage раньше, чем шторка
  // успеет доиграть выезд вниз (тот же паттерн, что был бы нужен и для
  // условного рендера по editUsageTarget && <..>, только без размонтирования).
  const [lastEditUsage, setLastEditUsage] = useState<StashUsage | null>(null);
  const [openSwipeSwatchId, setOpenSwipeSwatchId] = useState<string | null>(null);
  const [deleteSwatchTarget, setDeleteSwatchTarget] = useState<StashSwatch | null>(null);
  const [isDeletingSwatch, setIsDeletingSwatch] = useState(false);
  const [editSwatchTarget, setEditSwatchTarget] = useState<StashSwatch | null>(null);
  // Тот же паттерн, что lastEditUsage выше — EditSwatchModal должна
  // оставаться смонтированной во время анимации закрытия.
  const [lastEditSwatch, setLastEditSwatch] = useState<StashSwatch | null>(null);
  const [matchesLocked, setMatchesLocked] = useState(false);
  const [isMatchesPaywallOpen, setIsMatchesPaywallOpen] = useState(false);
  const [isYarnFixFormOpen, setIsYarnFixFormOpen] = useState(false);
  const [yarnFixMPer100g, setYarnFixMPer100g] = useState('');
  const [yarnFixComposition, setYarnFixComposition] = useState('');
  const [isSubmittingYarnFix, setIsSubmittingYarnFix] = useState(false);
  const [yarnFixError, setYarnFixError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [skeinData, matchesResult] = await Promise.all([
        fetchStashSkeinById(id),
        fetchStashMatches(id).catch(() => ({ items: [], isLocked: false })),
      ]);
      setSkein(skeinData);
      setMatches(matchesResult.items);
      setMatchesLocked(matchesResult.isLocked);
    } catch {
      setError('Не удалось загрузить карточку пряжи.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleBack = () => {
    if (canGoBackInApp()) navigate(-1);
    else navigate('/stash');
  };

  const handleConfirmDeleteUsage = async () => {
    if (!deleteUsageTarget || isDeletingUsage) return;
    setIsDeletingUsage(true);
    try {
      await undoStashUsage(deleteUsageTarget.id);
      const removedAmount = deleteUsageTarget.amountG;
      // Точечное обновление вместо load() — полная перезагрузка страницы
      // (setLoading(true) → короткий возврат к "Загрузка...") здесь не нужна:
      // сервер уже атомарно вернул amountG в currentWeightG (undoUsage),
      // остаётся лишь отразить тот же результат локально.
      setSkein((prev) => prev && {
        ...prev,
        currentWeightG: prev.currentWeightG + removedAmount,
        usages: prev.usages.filter((u) => u.id !== deleteUsageTarget.id),
      });
      setDeleteUsageTarget(null);
      setOpenSwipeUsageId(null);
    } catch {
      setError('Не удалось отменить списание. Попробуйте ещё раз.');
    } finally {
      setIsDeletingUsage(false);
    }
  };

  const handleConfirmDeleteSwatch = async () => {
    if (!deleteSwatchTarget || isDeletingSwatch) return;
    setIsDeletingSwatch(true);
    try {
      await deleteStashSwatch(deleteSwatchTarget.id);
      setSkein((prev) => prev && {
        ...prev,
        swatches: prev.swatches.filter((s) => s.id !== deleteSwatchTarget.id),
      });
      setDeleteSwatchTarget(null);
      setOpenSwipeSwatchId(null);
    } catch {
      setError('Не удалось удалить образец. Попробуйте ещё раз.');
    } finally {
      setIsDeletingSwatch(false);
    }
  };

  const handleSubmitYarnFix = async () => {
    if (!skein || isSubmittingYarnFix) return;
    const mPer100gValue = yarnFixMPer100g.trim() ? Number(yarnFixMPer100g) : undefined;
    const compositionValue = yarnFixComposition.trim() || undefined;
    if (mPer100gValue === undefined && compositionValue === undefined) {
      setYarnFixError('Укажите хотя бы одно значение');
      return;
    }
    setIsSubmittingYarnFix(true);
    setYarnFixError(null);
    try {
      await suggestYarnFields(skein.id, { mPer100g: mPer100gValue, composition: compositionValue });
      // Бэкенд сразу пишет значение в snapshot этого мотка (видно владельцу
      // немедленно, независимо от решения модератора по справочнику) —
      // перезагружаем карточку, чтобы отразить и снапшот, и статус заявки,
      // точечный патч по одному полю здесь избыточен.
      setIsYarnFixFormOpen(false);
      await load();
    } catch (err) {
      setYarnFixError(err instanceof Error ? err.message : 'Не удалось отправить заявку');
    } finally {
      setIsSubmittingYarnFix(false);
    }
  };

  if (loading) {
    return <p className="loading-message">Загрузка...</p>;
  }

  if (error || !skein) {
    return (
      <div className="stash-details-container">
        <button className="back-button" onClick={handleBack}>
          <img src={arrowLeftIcon} alt="Back" className="back-button-icon" />
          Назад
        </button>
        <p className="stash-details-error">{error || 'Пряжа не найдена'}</p>
      </div>
    );
  }

  const remainderPercent = skein.totalWeightG > 0
    ? Math.round((skein.currentWeightG / skein.totalWeightG) * 100)
    : 0;

  return (
    <div className="stash-details-container">
      <div className="stash-details-header">
        <button className="back-button" onClick={handleBack}>
          <img src={arrowLeftIcon} alt="Back" className="back-button-icon" />
          Назад
        </button>
        <button type="button" className="stash-details-edit-button" onClick={() => setIsEditOpen(true)} aria-label="Редактировать">
          <SquarePen size={24} strokeWidth={1.5} stroke="#9B9A9A" />
        </button>
      </div>

      <div className="stash-details-image-wrapper">
        <div className="stash-details-image-container">
          {skein.images.length > 0 ? (
            <StashImageCarousel images={skein.images} alt={skein.yarnNameSnapshot} />
          ) : (
            <div className="stash-details-image stash-details-image-placeholder">
              <img src={yarnPlaceholder} alt="" />
            </div>
          )}
        </div>
      </div>

      <div className="stash-details-info">
        <h1 className="stash-details-name">{skein.yarnNameSnapshot}</h1>
        {skein.brandSnapshot && <p className="stash-details-row"><b>Бренд:</b> {skein.brandSnapshot}</p>}
        {skein.compositionSnapshot && <p className="stash-details-row"><b>Состав:</b> {skein.compositionSnapshot}</p>}
        {skein.mPer100gSnapshot != null && <p className="stash-details-row"><b>Метраж:</b> {skein.mPer100gSnapshot} м/100г</p>}
        {skein.colorName && <p className="stash-details-row"><b>Цвет:</b> {skein.colorName}</p>}
        {skein.dyelot && <p className="stash-details-row"><b>Партия:</b> {skein.dyelot}</p>}

        <div className="stash-details-remainder">
          <p className="stash-details-row"><b>Остаток:</b> {skein.currentWeightG} г из {skein.totalWeightG} г</p>
          <div className="stash-progress-bar">
            <div className="stash-progress-fill" style={{ width: `${remainderPercent}%` }} />
          </div>
        </div>
      </div>

      {/* Заявка на дозаполнение обновляет snapshot этого мотка сразу (см.
          suggestYarnFields на бэкенде) — статус модерации в общий справочник
          пользователю не показываем: он не влияет на то, что тот видит и
          может делать дальше. Поле считается "пустым к дозаполнению" только
          пока у него нет значения ВООБЩЕ (снапшот всё ещё null) — как только
          заявка отправлена, снапшот заполняется и этот блок для него сам
          перестаёт рендериться. */}
      {(() => {
        const needsMPer100g = skein.mPer100gSnapshot == null;
        const needsComposition = skein.compositionSnapshot == null;
        if (!needsMPer100g && !needsComposition) return null;

        return (
          <div className="stash-details-yarn-fix">
            {
              isYarnFixFormOpen ? (
                <div className="stash-details-yarn-fix-form">
                  <p className="stash-details-section-title">Дозаполнить данные пряжи</p>
                  <p className="stash-details-yarn-fix-hint">
                    В справочнике не хватает части данных об этом артикуле — если знаете точные значения, предложите их. Значение появится у вас сразу, в общий справочник попадёт после проверки модератором.
                  </p>
                  {needsMPer100g && (
                    <div className="stash-details-yarn-fix-field">
                      <label className="stash-details-yarn-fix-label">Метраж, м/100г</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        className="stash-details-yarn-fix-input"
                        value={yarnFixMPer100g}
                        onChange={(e) => setYarnFixMPer100g(e.target.value)}
                        placeholder="Например, 240"
                      />
                    </div>
                  )}
                  {needsComposition && (
                    <div className="stash-details-yarn-fix-field">
                      <label className="stash-details-yarn-fix-label">Состав</label>
                      <input
                        type="text"
                        className="stash-details-yarn-fix-input"
                        value={yarnFixComposition}
                        onChange={(e) => setYarnFixComposition(e.target.value)}
                        placeholder="Например, 50% шерсть, 50% акрил"
                      />
                    </div>
                  )}
                  {yarnFixError && <p className="stash-details-yarn-fix-error">{yarnFixError}</p>}
                  <div className="stash-details-yarn-fix-actions">
                    <button
                      type="button"
                      className="btn stash-action-btn stash-action-btn--primary"
                      onClick={handleSubmitYarnFix}
                      disabled={isSubmittingYarnFix}
                    >
                      {isSubmittingYarnFix ? 'Отправка...' : 'Отправить на проверку'}
                    </button>
                    <button
                      type="button"
                      className="btn stash-action-btn stash-action-btn--secondary"
                      onClick={() => { setIsYarnFixFormOpen(false); setYarnFixError(null); }}
                      disabled={isSubmittingYarnFix}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="stash-details-yarn-fix-button" onClick={() => setIsYarnFixFormOpen(true)}>
                  Дозаполнить данные пряжи
                </button>
              )
            }
          </div>
        );
      })()}

      <div className="stash-details-swatches">
        <p className="stash-details-section-title">Образец</p>
        {skein.swatches.map((swatch) => (
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
            {swatch.needleSizeRaw && <p className="stash-details-row"><b>Спицы:</b> {swatch.needleSizeRaw}</p>}
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
          </SwipeToDelete>
        ))}
        <button type="button" className="stash-add-button" onClick={() => setIsAddSwatchOpen(true)}>
          <Plus size={32} strokeWidth={1} className="stash-add-button-plus" />
          Добавить образец
        </button>
      </div>

      {skein.note && (
        <div className="stash-details-notes">
          <p className="stash-details-section-title">Заметки</p>
          <p className="stash-notes-text">{skein.note}</p>
        </div>
      )}

      {skein.usages.length > 0 && (
        <div className="stash-details-usages">
          <p className="stash-details-section-title">Связано</p>
          {skein.usages.map((usage) => (
            <SwipeToDelete
              key={usage.id}
              isOpen={openSwipeUsageId === usage.id}
              onSwipeOpen={() => setOpenSwipeUsageId(usage.id)}
              onSwipeClose={() => setOpenSwipeUsageId((cur) => (cur === usage.id ? null : cur))}
              onTap={() => { if (usage.patternId) navigate(`/pattern/${usage.patternId}`); }}
              onRequestDelete={() => setDeleteUsageTarget(usage)}
              onRequestEdit={() => { setEditUsageTarget(usage); setLastEditUsage(usage); }}
              cardClassName="stash-usage-card"
            >
              <div className="stash-usage-image">
                {usage.finishedPhotos.length > 0 ? (
                  <StashImageCarousel images={usage.finishedPhotos} alt={usage.projectTitle || 'Готовое изделие'} classPrefix="stash-usage-image" />
                ) : (
                  <div className="stash-usage-image-placeholder">
                    <img src={projectPlaceholder} alt="" />
                  </div>
                )}
              </div>
              <div className="stash-usage-body">
                <p className="stash-usage-title">{usage.projectTitle || 'Без названия'}</p>
                {usage.patternAuthorSnapshot && (
                  <p className="stash-usage-row"><b>Автор:</b> {usage.patternAuthorSnapshot}</p>
                )}
                {usage.patternTitleSnapshot && (
                  <p className="stash-usage-row">
                    <b>Описание:</b>{' '}
                    {usage.patternTitleSnapshot}
                  </p>
                )}
                <p className="stash-usage-row"><b>Расход:</b> {usage.amountG} г</p>
                {usage.needleSizeRaw && (
                  <p className="stash-usage-row"><b>Спицы:</b> {usage.needleSizeRaw}</p>
                )}
              </div>
            </SwipeToDelete>
          ))}
        </div>
      )}

      {matches.length > 0 && (
        <div className="stash-details-matches">
          <p className="stash-details-section-title">Что можно связать из этой пряжи</p>
          <div className="stash-matches-list">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`stash-match-card${matchesLocked ? ' stash-match-card--locked' : ''}`}
                onClick={() => (matchesLocked ? setIsMatchesPaywallOpen(true) : navigate(`/pattern/${m.id}`))}
              >
                {matchesLocked ? (
                  <div className="stash-match-image-frame">
                    <img src={m.thumbnailUrl} alt="" className="stash-match-image stash-match-image--locked" />
                    <Lock size={16} strokeWidth={1.5} className="stash-match-lock-icon" />
                  </div>
                ) : (
                  <>
                    <img src={m.thumbnailUrl} alt="" className="stash-match-image" />
                    <p className="stash-match-title">{m.title}</p>
                    <div className="stash-match-meta">
                      <p className="stash-match-category">{m.category ?? '—'}</p>
                      <p className="stash-match-instrument">{m.instruments[0] ?? '—'}</p>
                    </div>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="stash-details-actions">
        <button
          type="button"
          className="btn stash-action-btn stash-action-btn--primary"
          onClick={() => setIsLogUsageOpen(true)}
          disabled={skein.currentWeightG <= 0}
        >
          Списать пряжу
        </button>
      </div>

      <Footer />

      <AddSwatchModal
        isOpen={isAddSwatchOpen}
        skeinId={skein.id}
        existingSkeinImages={skein.images}
        onClose={() => setIsAddSwatchOpen(false)}
        onCreated={() => {
          setIsAddSwatchOpen(false);
          load();
        }}
      />

      {lastEditSwatch && (
        <EditSwatchModal
          isOpen={!!editSwatchTarget}
          swatch={lastEditSwatch}
          onClose={() => setEditSwatchTarget(null)}
          onSaved={() => {
            setEditSwatchTarget(null);
            load();
          }}
        />
      )}

      <EditSkeinModal
        isOpen={isEditOpen}
        skein={skein}
        onClose={() => setIsEditOpen(false)}
        onSaved={() => {
          setIsEditOpen(false);
          load();
        }}
      />

      <LogUsageWizard
        isOpen={isLogUsageOpen}
        skein={skein}
        onClose={() => setIsLogUsageOpen(false)}
        onLogged={() => {
          setIsLogUsageOpen(false);
          load();
        }}
      />

      {lastEditUsage && (
        <EditUsageModal
          isOpen={!!editUsageTarget}
          skein={skein}
          usage={lastEditUsage}
          onClose={() => setEditUsageTarget(null)}
          onSaved={() => {
            setEditUsageTarget(null);
            load();
          }}
        />
      )}

      <DeleteConfirmModal
        isOpen={!!deleteUsageTarget}
        title="Отменить списание?"
        text={`«${deleteUsageTarget?.projectTitle || 'Без названия'}» — списанные ${deleteUsageTarget?.amountG ?? 0} г вернутся в остаток пряжи.`}
        isDeleting={isDeletingUsage}
        onCancel={() => setDeleteUsageTarget(null)}
        onConfirm={handleConfirmDeleteUsage}
      />

      <DeleteConfirmModal
        isOpen={!!deleteSwatchTarget}
        title="Удалить образец?"
        text="Образец будет удалён без возможности восстановить."
        isDeleting={isDeletingSwatch}
        onCancel={() => setDeleteSwatchTarget(null)}
        onConfirm={handleConfirmDeleteSwatch}
      />

      <StashPaywallBanner
        isOpen={isMatchesPaywallOpen}
        reason="matches"
        freeLimit={10}
        onClose={() => setIsMatchesPaywallOpen(false)}
      />
    </div>
  );
};
