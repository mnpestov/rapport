import { API_URL } from './config';
import { authorizedFetch } from './authSession';
import { StashSkein } from './stashApi';

const toAbsoluteUrl = (url: string) => (url.startsWith('/') ? `${API_URL}${url}` : url);

function withSkeinImageUrls(skein: StashSkein | null): StashSkein | null {
  if (!skein) return null;
  return { ...skein, images: skein.images.map(toAbsoluteUrl) };
}

export type ProjectStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'PAUSED';

export interface ProjectListItem {
  id: string;
  title: string;
  status: ProjectStatus;
  startedAt: string;
  completedAt: string | null;
  images: string[];
  finishedPhotos: string[];
  coverUrl: string | null;
  // Подпись карточки в списке — названия привязанных инструментов и
  // размер (мм) первой пары (проект, инструмент) — не со всех, см.
  // комментарий у PROJECT_LIST_SELECT на бэкенде. Имя поля унаследовано от
  // прежней реализации (бралось с образца), источник данных сменился на
  // ProjectInstrument.sizeMm, но по смыслу для подписи разницы нет.
  instrumentNames: string[];
  needleSizeRaw: string | null;
}

export interface ProjectPattern {
  id: string;
  projectId: string;
  patternId: string | null;
  patternTitleSnapshot: string;
  patternAuthorSnapshot: string;
  createdAt: string;
  // Живой каталожный паттерн (не снимок) — фото/инструмент для карточки
  // "Описание" (Figma node-id=1476:27969). Null, если паттерн удалён из
  // каталога (patternId стал null через onDelete: SetNull) — тогда
  // карточка показывает только снимки title/author, без фото/инструмента.
  pattern: {
    imageUrl: string;
    thumbnailUrl: string | null;
    instruments: { name: string }[];
  } | null;
}

export interface ProjectYarn {
  id: string;
  projectId: string;
  skeinId: string | null;
  yarnNameSnapshot: string;
  brandSnapshot: string | null;
  amountAtCompletionG: number | null;
  createdAt: string;
  skein: StashSkein | null;
}

export interface ProjectSwatch {
  id: string;
  projectId: string;
  images: string[];
  needleSizeRaw: string | null;
  // 'hook' = крючок, 'needle' = спицы, null = не указан (симметрично
  // StashSwatch.instrumentType).
  instrumentType: 'hook' | 'needle' | null;
  strandsCount: number | null;
  densityStitchesBefore: string | null;
  densityRowsBefore: string | null;
  densityStitchesAfter: string | null;
  densityRowsAfter: string | null;
  note: string | null;
  createdAt: string;
}

// Join-строка (ProjectInstrument на бэкенде) — размер (мм, число с
// дробной частью, напр. 2.25) хранится отдельно для каждой пары
// (проект, инструмент), не на справочнике инструментов.
export interface ProjectInstrument {
  id: string;
  instrumentId: string;
  sizeMm: number | null;
  instrument: { id: string; name: string };
}

// Payload для create/update формы — что шлёт AddProjectModal.
export interface ProjectInstrumentInput {
  instrumentId: string;
  sizeMm?: number | null;
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  originalFileName: string;
  fileSizeBytes: number;
  createdAt: string;
}

export interface ProjectUsage {
  id: string;
  skeinId: string;
  amountG: number;
  projectId: string | null;
  isBackdatedCompletion: boolean;
  createdAt: string;
}

export interface ProjectDetail {
  id: string;
  title: string;
  status: ProjectStatus;
  manualAuthor: string | null;
  manualDescription: string | null;
  startedAt: string;
  completedAt: string | null;
  note: string | null;
  images: string[];
  finishedPhotos: string[];
  referencePhotos: string[];
  links: string[];
  createdAt: string;
  updatedAt: string;
  patterns: ProjectPattern[];
  yarns: ProjectYarn[];
  swatches: ProjectSwatch[];
  instruments: ProjectInstrument[];
  documents: ProjectDocument[];
  usages: ProjectUsage[];
}

function withProjectImageUrls(item: ProjectDetail): ProjectDetail {
  return {
    ...item,
    images: item.images.map(toAbsoluteUrl),
    finishedPhotos: item.finishedPhotos.map(toAbsoluteUrl),
    referencePhotos: item.referencePhotos.map(toAbsoluteUrl),
    yarns: item.yarns.map((y) => ({ ...y, skein: withSkeinImageUrls(y.skein) })),
    swatches: item.swatches.map((s) => ({ ...s, images: s.images.map(toAbsoluteUrl) })),
    patterns: item.patterns.map((p) => ({
      ...p,
      pattern: p.pattern && {
        ...p.pattern,
        imageUrl: toAbsoluteUrl(p.pattern.imageUrl),
        thumbnailUrl: p.pattern.thumbnailUrl ? toAbsoluteUrl(p.pattern.thumbnailUrl) : null,
      },
    })),
  };
}

export class ProjectLimitReachedError extends Error {
  constructor(public limit: number) {
    super(`Бесплатный лимит ${limit} проектов исчерпан`);
  }
}

export interface FetchProjectsResponse {
  items: ProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalProjectCount: number;
}

export const fetchProjects = async (params: { page?: number; status?: ProjectStatus; q?: string } = {}): Promise<FetchProjectsResponse> => {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  const response = await authorizedFetch(`${API_URL}/projects?${qs.toString()}`, {}, 10000);
  if (!response.ok) throw new Error(`Failed to fetch projects: ${response.status}`);
  const data = await response.json();
  return {
    ...data,
    items: data.items.map((p: ProjectListItem) => ({
      ...p,
      images: p.images.map(toAbsoluteUrl),
      finishedPhotos: p.finishedPhotos.map(toAbsoluteUrl),
      coverUrl: p.coverUrl ? toAbsoluteUrl(p.coverUrl) : null,
    })),
  };
};

export const fetchProjectById = async (id: string): Promise<ProjectDetail> => {
  const response = await authorizedFetch(`${API_URL}/projects/${id}`, {}, 10000);
  if (!response.ok) throw new Error(`Failed to fetch project: ${response.status}`);
  const data: ProjectDetail = await response.json();
  return withProjectImageUrls(data);
};

export interface YarnUsageInput {
  skeinId: string;
  amountG?: number;
}

export interface CreateProjectPayload {
  title: string;
  status: ProjectStatus;
  startedAt?: string;
  completedAt?: string;
  patternIds?: string[];
  manualAuthor?: string;
  manualDescription?: string;
  instruments?: ProjectInstrumentInput[];
  note?: string;
  images?: string[];
  referencePhotos?: string[];
  links?: string[];
  // status !== COMPLETED -> skeinIds; status === COMPLETED -> yarnUsages
  // (ОДНО поле, форма зависит от статуса — см. PROJECTS_PLAN.md §2.2).
  skeinIds?: string[];
  yarnUsages?: YarnUsageInput[];
  finishedPhotos?: string[];
  swatches?: {
    images?: string[];
    needleSizeRaw?: string;
    instrumentType?: 'hook' | 'needle';
    strandsCount?: number;
    densityStitchesBefore?: number;
    densityRowsBefore?: number;
    densityStitchesAfter?: number;
    densityRowsAfter?: number;
    note?: string;
  }[];
}

export const createProject = async (payload: CreateProjectPayload): Promise<ProjectDetail> => {
  const response = await authorizedFetch(`${API_URL}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 403 && body?.code === 'PROJECT_LIMIT_REACHED') {
      throw new ProjectLimitReachedError(body.limit ?? 5);
    }
    throw new Error(body?.error || `Failed to create project: ${response.status}`);
  }
  return withProjectImageUrls(await response.json());
};

export interface UpdateProjectPayload {
  title?: string;
  status?: Exclude<ProjectStatus, 'COMPLETED'>;
  startedAt?: string;
  completedAt?: string | null;
  manualAuthor?: string | null;
  manualDescription?: string | null;
  patternIds?: string[];
  instruments?: ProjectInstrumentInput[];
  note?: string | null;
  images?: string[];
  referencePhotos?: string[];
  links?: string[];
  finishedPhotos?: string[];
}

export const updateProject = async (id: string, payload: UpdateProjectPayload): Promise<ProjectDetail> => {
  const response = await authorizedFetch(`${API_URL}/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to update project: ${response.status}`);
  }
  return withProjectImageUrls(await response.json());
};

export interface CompleteProjectPayload {
  yarnUsages: YarnUsageInput[];
  instruments?: ProjectInstrumentInput[];
  patternIds?: string[];
  manualAuthor?: string;
  manualDescription?: string;
  title?: string;
  finishedPhotos: string[];
}

export const completeProject = async (id: string, payload: CompleteProjectPayload): Promise<ProjectDetail> => {
  const response = await authorizedFetch(`${API_URL}/projects/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to complete project: ${response.status}`);
  }
  return withProjectImageUrls(await response.json());
};

export const deleteProject = async (id: string, returnYarnToStash: boolean): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/projects/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnYarnToStash }),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to delete project: ${response.status}`);
  }
};

export const addProjectPattern = async (projectId: string, patternId: string): Promise<ProjectPattern> => {
  const response = await authorizedFetch(`${API_URL}/projects/${projectId}/patterns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patternId }),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to add pattern: ${response.status}`);
  }
  return response.json();
};

export const removeProjectPattern = async (projectId: string, patternId: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/projects/${projectId}/patterns/${patternId}`, { method: 'DELETE' }, 10000);
  if (!response.ok) throw new Error(`Failed to remove pattern: ${response.status}`);
};

export const addProjectYarn = async (projectId: string, skeinId: string): Promise<ProjectYarn> => {
  const response = await authorizedFetch(`${API_URL}/projects/${projectId}/yarns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skeinId }),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to add yarn: ${response.status}`);
  }
  return response.json();
};

export const removeProjectYarn = async (projectId: string, skeinId: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/projects/${projectId}/yarns/${skeinId}`, { method: 'DELETE' }, 10000);
  if (!response.ok) throw new Error(`Failed to remove yarn: ${response.status}`);
};

export const addProjectInstrument = async (projectId: string, instrumentId: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/projects/${projectId}/instruments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instrumentId }),
  }, 10000);
  if (!response.ok) throw new Error(`Failed to add instrument: ${response.status}`);
};

export const removeProjectInstrument = async (projectId: string, instrumentId: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/projects/${projectId}/instruments/${instrumentId}`, { method: 'DELETE' }, 10000);
  if (!response.ok) throw new Error(`Failed to remove instrument: ${response.status}`);
};

export interface CreateProjectSwatchPayload {
  images?: string[];
  needleSizeRaw?: string;
  instrumentType?: 'hook' | 'needle';
  strandsCount?: number;
  densityStitchesBefore?: number;
  densityRowsBefore?: number;
  densityStitchesAfter?: number;
  densityRowsAfter?: number;
  note?: string;
}

export const createProjectSwatch = async (projectId: string, payload: CreateProjectSwatchPayload): Promise<ProjectSwatch> => {
  const response = await authorizedFetch(`${API_URL}/projects/${projectId}/swatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to create swatch: ${response.status}`);
  }
  const data = await response.json();
  return { ...data, images: data.images.map(toAbsoluteUrl) };
};

export const updateProjectSwatch = async (id: string, payload: CreateProjectSwatchPayload): Promise<ProjectSwatch> => {
  const response = await authorizedFetch(`${API_URL}/projects/swatches/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to update swatch: ${response.status}`);
  }
  const data = await response.json();
  return { ...data, images: data.images.map(toAbsoluteUrl) };
};

export const deleteProjectSwatch = async (id: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/projects/swatches/${id}`, { method: 'DELETE' }, 10000);
  if (!response.ok) throw new Error(`Failed to delete swatch: ${response.status}`);
};

// ─── PDF-описания (PROJECTS_PLAN.md §8.1) ─────────────────────────────────

export const uploadProjectDocument = async (projectId: string, file: File): Promise<ProjectDocument> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await authorizedFetch(`${API_URL}/projects/${projectId}/documents`, {
    method: 'POST',
    body: formData,
  }, 30000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to upload document: ${response.status}`);
  }
  return response.json();
};

export const deleteProjectDocument = async (id: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/projects/documents/${id}`, { method: 'DELETE' }, 10000);
  if (!response.ok) throw new Error(`Failed to delete document: ${response.status}`);
};

// Файл раздаётся авторизованным эндпоинтом (не голый <a href>, тот не
// понёс бы заголовок Authorization) — PdfViewerModal грузит байты через
// authorizedFetch и строит Blob URL сам, см. fetchProjectDocumentBlob.
export const fetchProjectDocumentBlob = async (documentId: string): Promise<Blob> => {
  const response = await authorizedFetch(`${API_URL}/projects/documents/${documentId}/file`, {}, 30000);
  if (!response.ok) throw new Error(`Failed to fetch document file: ${response.status}`);
  return response.blob();
};

export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectDocumentHighlight {
  id: string;
  documentId: string;
  pageNumber: number;
  rects: HighlightRect[];
  color: string;
  createdAt: string;
}

export const fetchDocumentHighlights = async (documentId: string, pageNumber: number): Promise<ProjectDocumentHighlight[]> => {
  const response = await authorizedFetch(`${API_URL}/projects/documents/${documentId}/highlights?page=${pageNumber}`, {}, 10000);
  if (!response.ok) throw new Error(`Failed to fetch highlights: ${response.status}`);
  return response.json();
};

export const createDocumentHighlight = async (
  documentId: string,
  payload: { pageNumber: number; rects: HighlightRect[]; color: string }
): Promise<ProjectDocumentHighlight> => {
  const response = await authorizedFetch(`${API_URL}/projects/documents/${documentId}/highlights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to create highlight: ${response.status}`);
  }
  return response.json();
};

export const deleteDocumentHighlight = async (id: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/projects/documents/highlights/${id}`, { method: 'DELETE' }, 10000);
  if (!response.ok) throw new Error(`Failed to delete highlight: ${response.status}`);
};

// ─── Штрихи пера в PDF (§8.2) ─── отдельно от highlights — произвольная
// рукописная линия, не привязанная к тексту (см. комментарий у
// ProjectDocumentDrawing на бэкенде).

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface ProjectDocumentDrawing {
  id: string;
  documentId: string;
  pageNumber: number;
  points: DrawingPoint[];
  createdAt: string;
}

export const fetchDocumentDrawings = async (documentId: string, pageNumber: number): Promise<ProjectDocumentDrawing[]> => {
  const response = await authorizedFetch(`${API_URL}/projects/documents/${documentId}/drawings?page=${pageNumber}`, {}, 10000);
  if (!response.ok) throw new Error(`Failed to fetch drawings: ${response.status}`);
  return response.json();
};

export const createDocumentDrawing = async (
  documentId: string,
  payload: { pageNumber: number; points: DrawingPoint[] }
): Promise<ProjectDocumentDrawing> => {
  const response = await authorizedFetch(`${API_URL}/projects/documents/${documentId}/drawings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to create drawing: ${response.status}`);
  }
  return response.json();
};

export const deleteDocumentDrawing = async (id: string): Promise<void> => {
  const response = await authorizedFetch(`${API_URL}/projects/documents/drawings/${id}`, { method: 'DELETE' }, 10000);
  if (!response.ok) throw new Error(`Failed to delete drawing: ${response.status}`);
};
