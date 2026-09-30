import React from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
  titleClassName?: string;
  children: React.ReactNode;
}

// Сворачиваемый блок карточки проекта (Figma node-id=1619:20364) —
// заголовок с шевроном (клик по всему заголовку, не только по иконке)
// раскрывает/прячет содержимое. Шеврон развёрнутого блока смотрит вверх
// (rotate 180° в макете), свёрнутого — вниз (дефолт). Персистентность
// состояния (localStorage) и ключи секций — на стороне ProjectDetails.tsx,
// этот компонент только рендерит текущее isOpen/onToggle.
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  isOpen,
  onToggle,
  className = '',
  titleClassName = 'stash-details-section-title',
  children,
}) => {
  return (
    <div className={`project-collapsible ${className}`}>
      <button type="button" className="project-collapsible-header" onClick={onToggle}>
        <p className={titleClassName}>{title}</p>
        <ChevronDown size={16} strokeWidth={1.5} className={`project-collapsible-chevron ${isOpen ? 'project-collapsible-chevron--open' : ''}`} />
      </button>
      {isOpen && <div className="project-collapsible-body">{children}</div>}
    </div>
  );
};
