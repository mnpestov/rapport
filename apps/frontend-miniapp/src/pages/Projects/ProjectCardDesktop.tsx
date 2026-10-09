import React from 'react';
import { Trash2 } from 'lucide-react';
import { ProjectListItem } from '../../api/projectsApi';
import { STATUS_LABEL, STATUS_COLOR, STATUS_ICON } from './projectStatus';
import projectPlaceholder from '../../components/TabBar/icons/project1.svg';

interface ProjectCardDesktopProps {
  item: ProjectListItem;
  onOpen: () => void;
  onRequestDelete: () => void;
}

// Десктопный аналог SwipeableProjectCard.tsx (Figma node-id=1637:21739) —
// тот же контент (обложка/статус-бейдж/название/инструмент), но с явной
// иконкой корзины вместо отсутствующего на мобиле удаления (там удаление
// живёт только на карточке проекта, ProjectDetails.tsx — список сам ничего
// не удаляет). Подтверждение — тот же DeleteProjectConfirmModal, что и на
// карточке (см. Projects.tsx), состояние удаления общее с родителем.
export const ProjectCardDesktop: React.FC<ProjectCardDesktopProps> = ({ item, onOpen, onRequestDelete }) => {
  const Icon = STATUS_ICON[item.status];

  return (
    <div className="projects-card-desktop">
      <button type="button" className="projects-card-desktop-main" onClick={onOpen}>
        <div className="projects-card-desktop-image">
          <img src={item.coverUrl || projectPlaceholder} alt="" className={item.coverUrl ? '' : 'projects-grid-card-image-placeholder'} />
          <div className="projects-grid-card-badge" style={{ background: STATUS_COLOR[item.status] }}>
            <span className="projects-status-icon-wrap">
              <Icon size={13} strokeWidth={1.5} color="#ffffff" />
            </span>
            <span>{STATUS_LABEL[item.status]}</span>
          </div>
        </div>
        <div className="projects-grid-card-body">
          <p className="projects-grid-card-title">{item.title}</p>
          {item.instrumentNames.length > 0 && (
            <p className="projects-grid-card-meta">
              <b>{item.instrumentNames[0]}:</b> {item.needleSizeRaw != null ? item.needleSizeRaw.replace('.', ',') : '—'}
            </p>
          )}
        </div>
      </button>
      <button type="button" className="projects-card-desktop-delete" onClick={onRequestDelete} aria-label="Удалить">
        <Trash2 size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
};
