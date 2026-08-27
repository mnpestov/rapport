import { SquarePen, Image as ImageIcon, Check, Star, Wrench, MessageCircleX } from "lucide-react";
import { IconButton } from '../../components/Button/Button';

function CheckboxIcon({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24 }}
    >
      {checked ? (
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 16L14.6667 18.6667L20 13.3333M6.66667 4H25.3333C26.8061 4 28 5.19391 28 6.66667V25.3333C28 26.8061 26.8061 28 25.3333 28H6.66667C5.19391 28 4 26.8061 4 25.3333V6.66667C4 5.19391 5.19391 4 6.66667 4Z" stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M25.3333 4H6.66667C5.19391 4 4 5.19391 4 6.66667V25.3333C4 26.8061 5.19391 28 6.66667 28H25.3333C26.8061 28 28 26.8061 28 25.3333V6.66667C28 5.19391 26.8061 4 25.3333 4Z" stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
import { AdminPatternItem } from "../../api/patterns";
import { API_URL } from "../../api/config";
import styles from "./PatternCard.module.css";

function getImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

export type PatternStatusKind = "draft" | "pending" | "rejected" | "published";

export interface PatternStatus {
  label: string;
  kind: PatternStatusKind;
  comment?: string | null;
}

interface PatternCardProps {
  item: AdminPatternItem;
  status?: PatternStatus;
  isSelected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
  onEdit: (id: string) => void;
  editDisabled?: boolean;
}

export function PatternCard({
  item,
  status,
  isSelected = false,
  onSelect,
  onEdit,
  editDisabled = false,
}: PatternCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <div className={styles.colCheckbox}>
          <CheckboxIcon checked={isSelected} onChange={(v) => onSelect?.(item.id, v)} />
        </div>

        <div className={styles.colImage}>
          {item.preview ? (
            <img src={getImageUrl(item.preview)} alt={item.title} className={styles.previewImage} />
          ) : (
            <div className={styles.previewPlaceholder}>
              <ImageIcon size={20} strokeWidth={1} />
            </div>
          )}
        </div>

        <div className={`${styles.colDate} ${styles.dateCell}`}>
          {new Date(item.createdAt).toLocaleDateString("ru-RU")}
        </div>

        <div className={`${styles.colTitle} ${styles.cell}`}>
          <span className={styles.titleText}>{item.title}</span>
        </div>

        <div className={styles.colFree}>
          {item.isNew ? <Check size={16} strokeWidth={1} color="#1d1c1c" /> : null}
        </div>

        <div className={`${styles.colCategory} ${styles.cell}`}>{item.category}</div>
        <div className={`${styles.colChars} ${styles.cell}`}>{item.characteristics}</div>

        <div className={`${styles.colLink} ${styles.cell}`}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className={styles.link}>
              ссылка
            </a>
          ) : (
            "—"
          )}
        </div>

        <div className={`${styles.colAuthor} ${styles.cell}`}>{item.author}</div>
        <div className={`${styles.colInstrument} ${styles.cell}`}>{item.instrument}</div>
        <div className={`${styles.colThickness} ${styles.cell}`}>{item.thickness || "—"}</div>
        <div className={`${styles.colDensity} ${styles.cell}`}>{item.density || "—"}</div>

        <div className={styles.colEdit}>
          <IconButton
            title="Редактировать"
            onClick={() => onEdit(item.id)}
            disabled={editDisabled}
          >
            <SquarePen size={24} strokeWidth={1} />
          </IconButton>
        </div>
      </div>

      {status?.kind === "rejected" && status.comment && (
        <div className={styles.rejectBanner}>
          <MessageCircleX size={16} strokeWidth={1} />
          <span>{status.comment}</span>
        </div>
      )}
    </div>
  );
}

interface PatternCardHeaderProps {
  allSelected?: boolean;
  onSelectAll?: (checked: boolean) => void;
}

export function PatternCardHeader({ allSelected = false, onSelectAll }: PatternCardHeaderProps) {
  return (
    <div className={styles.row} style={{ borderBottom: "1px solid var(--surface-gray)" }}>
      <div className={styles.colCheckbox}>
        <CheckboxIcon checked={allSelected} onChange={(v) => onSelectAll?.(v)} />
      </div>
      <div className={styles.colImage} />
      <div className={`${styles.colDate} ${styles.headerCell}`}>Дата</div>
      <div className={`${styles.colTitle} ${styles.headerCell}`}>Название</div>
      <div className={`${styles.colFree} ${styles.headerCell}`}>
        <Star size={20} strokeWidth={1} color="#1d1c1c" />
      </div>
      <div className={`${styles.colCategory} ${styles.headerCell}`}>Категория</div>
      <div className={`${styles.colChars} ${styles.headerCell}`}>Хар-ки</div>
      <div className={`${styles.colLink} ${styles.headerCell}`}>Ссылка</div>
      <div className={`${styles.colAuthor} ${styles.headerCell}`}>Автор</div>
      <div className={`${styles.colInstrument} ${styles.headerCell}`}>
        <Wrench size={20} strokeWidth={1} color="#1d1c1c" />
      </div>
      <div className={`${styles.colThickness} ${styles.headerCell}`}>Толщина</div>
      <div className={`${styles.colDensity} ${styles.headerCell}`}>Плотность</div>
      <div className={styles.colEdit} />
    </div>
  );
}
