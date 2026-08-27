import { ReactNode } from "react";
import { Button } from "../../components/Button/Button";
import { AdminPatternItem } from "../../api/patterns";
import { API_URL } from "../../api/config";
import styles from "./ModerationCard.module.css";

interface PatternGridCardProps {
  item: AdminPatternItem;
  onEdit: (id: string) => void;
  actionLabel: string;
  onAction: (id: string) => void;
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

export function PatternGridCard({ item, onEdit, actionLabel, onAction }: PatternGridCardProps) {
  const imgSrc = getImageUrl(item.preview);

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
        <div className={styles.authorName}>{item.author}</div>
        <div className={styles.row}>
          <span className={styles.label}>Дата</span>
          <span className={styles.value}>{new Date(item.createdAt).toLocaleDateString("ru-RU")}</span>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.rows}>
          <Row label="Название">
            <span className={styles.titleValue}>{item.title}</span>
          </Row>
          {!!item.isNew && <Row label="Новинка"><CheckboxGlyph checked={item.isNew} /></Row>}
          {!!item.isFree && <Row label="Бесплатное"><CheckboxGlyph checked={!!item.isFree} /></Row>}
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

        <div className={styles.actions}>
          <Button onClick={() => onAction(item.id)}>
            {actionLabel}
          </Button>
          <Button variant="secondary" onClick={() => onEdit(item.id)}>
            Редактировать
          </Button>
        </div>
      </div>
    </div>
  );
}
