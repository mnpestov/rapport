import { ReactNode } from "react";
import { AdminDraft } from "../../api/admin-drafts";
import { API_URL } from "../../api/config";
import styles from "./ModerationCard.module.css";

interface ModerationCardProps {
  draft: AdminDraft;
  onApprove: (id: string) => Promise<void>;
  onReject: (draft: AdminDraft) => void;
  onEdit?: (draft: AdminDraft) => void;
  approveLabel?: string;
  rejectLabel?: string;
}

function getImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function CheckboxGlyph({ checked }: { checked: boolean }) {
  return checked ? (
    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 16L14.6667 18.6667L20 13.3333M6.66667 4H25.3333C26.8061 4 28 5.19391 28 6.66667V25.3333C28 26.8061 26.8061 28 25.3333 28H6.66667C5.19391 28 4 26.8061 4 25.3333V6.66667C4 5.19391 5.19391 4 6.66667 4Z" stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M25.3333 4H6.66667C5.19391 4 4 5.19391 4 6.66667V25.3333C4 26.8061 5.19391 28 6.66667 28H25.3333C26.8061 28 28 26.8061 28 25.3333V6.66667C28 5.19391 26.8061 4 25.3333 4Z" stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

function Stack({ items }: { items: { id: string; name: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.stack}>
      {items.map((item) => (
        <span key={item.id}>{item.name}</span>
      ))}
    </div>
  );
}

export function ModerationCard({ draft, onApprove, onReject, onEdit, approveLabel = "Опубликовать", rejectLabel = "Отклонить" }: ModerationCardProps) {
  const imgSrc = getImageUrl(draft.thumbnailUrl);

  return (
    <div className={styles.card}>
      <div className={styles.left}>
        <div className={styles.img}>
          {imgSrc ? (
            <img src={imgSrc} alt={draft.title} />
          ) : (
            <div className={styles.imgPlaceholder}>Нет фото</div>
          )}
        </div>
        <div className={styles.authorName}>{draft.author.name}</div>
        <div className={styles.row}>
          <span className={styles.label}>Дата</span>
          <span className={styles.value}>{new Date(draft.createdAt).toLocaleDateString("ru-RU")}</span>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.rows}>
          <Row label="Название">
            <span className={styles.titleValue}>{draft.title}</span>
            {draft.patternId && <span className={styles.editBadge}>Правка</span>}
          </Row>
          {!!draft.isNew && <Row label="Новинка"><CheckboxGlyph checked={draft.isNew} /></Row>}
          {!!draft.isFree && <Row label="Бесплатное"><CheckboxGlyph checked={draft.isFree} /></Row>}
          {draft.categories.length > 0 && <Row label="Категория"><Stack items={draft.categories} /></Row>}
          {draft.tags.length > 0 && <Row label="Хар-ки"><Stack items={draft.tags} /></Row>}
          {!!draft.url && (
            <Row label="Ссылка">
              <a href={draft.url} target="_blank" rel="noreferrer" className={styles.link}>ссылка</a>
            </Row>
          )}
          {draft.instruments.length > 0 && <Row label="Инструмент"><Stack items={draft.instruments} /></Row>}
          {draft.yarnRanges.length > 0 && (
            <Row label="Толщина нити">
              <span>{draft.yarnRanges.map((y) => y.label).join(", ")}</span>
            </Row>
          )}
          {draft.densityStitches != null && draft.densityRows != null && (
            <Row label="Плотность">
              <span>{`${draft.densityStitches} х ${draft.densityRows}`}</span>
            </Row>
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.approveBtn} onClick={() => onApprove(draft.id)}>
            {approveLabel}
          </button>
          <button className={styles.rejectBtn} onClick={() => onReject(draft)}>
            {rejectLabel}
          </button>
          {onEdit && (
            <button className={styles.editBtn} onClick={() => onEdit(draft)}>
              Редактировать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
