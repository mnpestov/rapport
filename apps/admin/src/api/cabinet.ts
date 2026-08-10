import { API_URL } from './config';
import { fetchWithAuth } from './fetchWithAuth';

export interface CabinetAuthor {
  id: string;
  name: string;
}

export interface CabinetDraft {
  id: string;
  patternId: string | null;
  pattern?: { id: string; title: string } | null;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  moderationComment: string | null;
  title: string;
  url: string;
  imageUrl: string;
  images: string[];
  details: string | null;
  price: number | string | null;
  oldPrice: number | string | null;
  isFree: boolean;
  isNew: boolean;
  densityStitches: number | string | null;
  densityRows: number | string | null;
  createdAt: string;
  updatedAt: string;
  _type: 'draft';
  tags: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  instruments: { id: string; name: string }[];
  yarnRanges: { id: string; label: string }[];
}

export interface CabinetPattern {
  id: string;
  title: string;
  url: string;
  imageUrl: string;
  images: string[];
  details: string | null;
  price: number | string | null;
  oldPrice: number | string | null;
  isFree: boolean;
  isNew: boolean;
  isVisible: boolean;
  densityStitches: number | string | null;
  densityRows: number | string | null;
  createdAt: string;
  updatedAt: string;
  _type: 'pattern';
  tags: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  instruments: { id: string; name: string }[];
  yarnRanges: { id: string; label: string }[];
}

export type CabinetItem = CabinetDraft | CabinetPattern;

export const getCabinetAuthor = async (): Promise<{ author: CabinetAuthor }> => {
  const res = await fetchWithAuth(`${API_URL}/author/me`);
  if (!res.ok) throw new Error('Failed to fetch author profile');
  return res.json();
};

export const getCabinetItems = async (): Promise<{ drafts: CabinetDraft[]; patterns: CabinetPattern[] }> => {
  const res = await fetchWithAuth(`${API_URL}/author/patterns`);
  if (!res.ok) throw new Error('Failed to fetch items');
  return res.json();
};

export const createCabinetDraft = async (data: {
  title: string;
  url: string;
  images: string[];
  details?: string | null;
  price?: number | string | null;
  oldPrice?: number | string | null;
  isFree?: boolean;
  isNew?: boolean;
  categories?: string[];
  tags?: string[];
  instruments?: string[];
  yarnRangeIds?: string[];
  densityStitches?: number | string;
  densityRows?: number | string;
}): Promise<CabinetDraft> => {
  const res = await fetchWithAuth(`${API_URL}/author/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to create draft');
  }
  return res.json();
};

export const updateCabinetDraft = async (
  id: string,
  data: {
    title?: string;
    url?: string;
    images?: string[];
    details?: string | null;
    price?: number | string | null;
    oldPrice?: number | string | null;
    isFree?: boolean;
    isNew?: boolean;
    categories?: string[];
    tags?: string[];
    instruments?: string[];
    yarnRangeIds?: string[];
    densityStitches?: number | string;
    densityRows?: number | string;
  }
): Promise<CabinetDraft> => {
  const res = await fetchWithAuth(`${API_URL}/author/drafts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to update draft');
  }
  return res.json();
};

export const submitCabinetDraft = async (id: string): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${API_URL}/author/drafts/${id}/submit`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to submit draft');
  }
  return res.json();
};

export const createEditDraft = async (patternId: string): Promise<CabinetDraft> => {
  const res = await fetchWithAuth(`${API_URL}/author/patterns/${patternId}/edit`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to create edit draft');
  }
  return res.json();
};

export const deleteCabinetDraft = async (id: string): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${API_URL}/author/drafts/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to delete draft');
  }
  return res.json();
};

export const archiveCabinetPattern = async (id: string): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${API_URL}/author/patterns/${id}/archive`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to archive pattern');
  }
  return res.json();
};
