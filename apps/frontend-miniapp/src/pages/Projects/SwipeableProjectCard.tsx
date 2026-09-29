import React from 'react';
import { ProjectListItem } from '../../api/projectsApi';
import { STATUS_LABEL, STATUS_COLOR, STATUS_ICON } from './projectStatus';
import projectPlaceholder from '../../components/TabBar/icons/project.svg';

interface ProjectCardProps {
  item: ProjectListItem;
  onOpen: () => void;
}

// Двухколоночный грид (Figma) не сочетается со свайп-удалением карточки
// (SwipeToDelete раскрывает кнопки вправо на всю ширину строки, а не узкой
// колонки) — удаление проекта живёт на ProjectDetails.tsx, список только
// открывает карточку по тапу.
export const SwipeableProjectCard: React.FC<ProjectCardProps> = ({ item, onOpen }) => {
  const Icon = STATUS_ICON[item.status];

  return (
    <button type="button" className="projects-grid-card" onClick={onOpen}>
      <div className="projects-grid-card-image">
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
  );
};
