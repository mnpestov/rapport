import { Star, Repeat2, Check, CirclePause } from 'lucide-react';
import type { ProjectStatus } from '../../api/projectsApi';

// Единый источник правды для лейбла/цвета/иконки статуса проекта — Figma
// node-id=1567:23115 (Badge, варианты "В планах"/"В процессе"/
// "Завершено"/"На паузе"). Раньше эти три карты были продублированы по
// отдельности в AddProjectModal.tsx/ProjectDetails.tsx/Projects.tsx/
// SwipeableProjectCard.tsx и успели разъехаться (разные цвета "В
// процессе", разные лейблы "на паузе"/"на стопе"/"пауза") — единственная
// причина, по которой статус выглядел по-разному на разных страницах.
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNED: 'В планах',
  IN_PROGRESS: 'В процессе',
  PAUSED: 'На паузе',
  COMPLETED: 'Завершено',
};

export const STATUS_COLOR: Record<ProjectStatus, string> = {
  PLANNED: '#bec1f4',
  IN_PROGRESS: '#abc6ba',
  PAUSED: '#9b9a9a',
  COMPLETED: '#a9ae36',
};

export const STATUS_ICON: Record<ProjectStatus, typeof Star> = {
  PLANNED: Star,
  IN_PROGRESS: Repeat2,
  PAUSED: CirclePause,
  COMPLETED: Check,
};

// Порядок статусов в dropdown/фильтрах — тот же, что в макете
// (планы → процесс → пауза → завершено), не порядок объявления enum на
// бэкенде (там PLANNED идёт первым по другой причине — алфавитно-логической).
export const STATUS_ORDER: ProjectStatus[] = ['PLANNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'];
