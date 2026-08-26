import { API_URL } from './config';
import { fetchWithAuth } from './fetchWithAuth';

export interface AdminDraft {
  id: string;
  patternId: string | null;
  pattern: { id: string; title: string } | null;
  authorId: string;
  author: { id: string; name: string };
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  moderationComment: string | null;
  title: string;
  url: string;
  imageUrl: string;
  thumbnailUrl: string;
  images: string[];
  details: string | null;
  price: number | string | null;
  oldPrice: number | string | null;
  isFree: boolean;
  isNew: boolean;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  densityStitches: number | string | null;
  densityRows: number | string | null;
  tags: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  instruments: { id: string; name: string }[];
  yarnRanges: { id: string; label: string }[];
  /** Артикулы, найденные скрапером. У настоящих Draft из кабинета их нет —
      скрапер туда не пишет, — поэтому поле необязательное. */
  yarns?: { id: string; name: string; matchRule?: string | null }[];
  yarnMentions?: { rawText: string; kind: string; metrageInText?: string | null }[];
}

export const getAdminDrafts = async (status?: string): Promise<AdminDraft[]> => {
  const q = status ? `?status=${status}` : '';
  const res = await fetchWithAuth(`${API_URL}/admin/drafts${q}`);
  if (!res.ok) throw new Error(`Failed to fetch drafts: ${res.statusText}`);
  return res.json();
};

export const approveDraft = async (id: string): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${API_URL}/admin/drafts/${id}/approve`, {
    method: 'POST',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || `Failed to approve draft: ${res.statusText}`);
  }
  return res.json();
};

export const rejectDraft = async (id: string, moderationComment: string): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${API_URL}/admin/drafts/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moderationComment }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || `Failed to reject draft: ${res.statusText}`);
  }
  return res.json();
};
