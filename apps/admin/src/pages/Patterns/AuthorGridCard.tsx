import { MessageCircleX } from "lucide-react";
import { Button } from "../../components/Button/Button";
import { AdminPatternItem } from "../../api/patterns";
import { API_URL } from "../../api/config";
import type { PatternStatus } from "./PatternCard";
import styles from "./ModerationCard.module.css";

// Mobile grid counterpart to PatternCard's list row for the author cabinet
// (implementation_plan-adjacent — mirrors PatternGridCard, admin's own
// mobile-grid card, but without a second action button: an author archives
// or deletes via the bulk selection + "Удалить выбранное" bar below the
// list, not per-card, so there's nothing to wire up here besides Edit).
interface AuthorGridCardProps {
  item: AdminPatternItem;
  status: PatternStatus;
  isSelected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onEdit: (id: string) => void;
  editDisabled?: boolean;
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

const STATUS_BADGE_STYLE: Record<PatternStatus["kind"], { background: string; color: string }> = {
  draft: { background: "var(--surface-gray)", color: "var(--text-muted)" },
  pending: { background: "#fef3c7", color: "#92400e" },
  rejected: { background: "var(--danger)", color: "var(--surface)" },
  published: { background: "var(--brand)", color: "var(--surface)" },
};

export function AuthorGridCard({ item, status, isSelected, onSelect, onEdit, editDisabled = false }: AuthorGridCardProps) {
  const imgSrc = getImageUrl(item.preview);
  const badgeStyle = STATUS_BADGE_STYLE[status.kind];

  return (
    <div className={styles.card}>
      <div className={styles.left}>
        <div className={styles.img}>
          {imgSrc ? (
            <img src={imgSrc} alt={item.title} />
          ) : (
            <div className={styles.imgPlaceholder}>Нет фото</div>
          )}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <span
            role="checkbox"
            aria-checked={isSelected}
            onClick={() => onSelect(item.id, !isSelected)}
            style={{ display: "inline-flex", cursor: "pointer" }}
          >
            <CheckboxGlyph checked={isSelected} />
          </span>
          <span
            style={{
              ...badgeStyle,
              borderRadius: 4,
              padding: "1px 8px",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {status.label}
          </span>
        </label>
      </div>

      <div className={styles.right}>
        <div className={styles.rows}>
          <Row label="Название">
            <span className={styles.titleValue}>{item.title}</span>
          </Row>
          {!!item.isNew && <Row label="Новинка"><CheckboxGlyph checked /></Row>}
          {!!item.category && <Row label="Категория"><span>{item.category}</span></Row>}
          {!!item.characteristics && <Row label="Хар-ки"><span>{item.characteristics}</span></Row>}
          {!!item.url && (
            <Row label="Ссылка">
              <a href={item.url} target="_blank" rel="noreferrer" className={styles.link}>ссылка</a>
            </Row>
          )}
          {!!item.instrument && <Row label="Инструмент"><span>{item.instrument}</span></Row>}
          {!!item.thickness && <Row label="Толщина нити"><span>{item.thickness}</span></Row>}
          {!!item.density && <Row label="Плотность"><span>{item.density}</span></Row>}
        </div>

        {status.kind === "rejected" && status.comment && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", borderRadius: 2, background: "var(--warning)", color: "var(--surface)", fontSize: 13 }}>
            <MessageCircleX size={16} strokeWidth={1} />
            <span>{status.comment}</span>
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="secondary" disabled={editDisabled} onClick={() => onEdit(item.id)} block>
            Редактировать
          </Button>
        </div>
      </div>
    </div>
  );
}
