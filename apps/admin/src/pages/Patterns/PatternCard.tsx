import { SquarePen, Image as ImageIcon, EyeOff } from "lucide-react";
import { AdminPatternItem } from "../../api/patterns";
import { API_URL } from "../../api/config";
import styles from "./PatternCard.module.css";

function getImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface PatternCardProps {
  item: AdminPatternItem;
  isSelected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onEdit: (id: string) => void;
}

export function PatternCard({ item, isSelected, onSelect, onEdit }: PatternCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.colCheckbox}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onSelect(item.id, e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "#9B9A9A", cursor: "pointer" }}
        />
      </div>

      <div className={styles.colImage}>
        {item.preview ? (
          <img src={getImageUrl(item.preview)} alt={item.title} className={styles.previewImage} />
        ) : (
          <div className={styles.previewPlaceholder}>
            <ImageIcon size={20} />
          </div>
        )}
      </div>

      <div className={`${styles.colDate} ${styles.cell}`}>
        {new Date(item.createdAt).toLocaleDateString("ru-RU")}
      </div>

      <div className={`${styles.colTitle} ${styles.cell}`}>
        <span className={styles.titleText}>{item.title}</span>
        {!item.isVisible && (
          <span className={styles.hiddenBadge}>
            <EyeOff size={12} /> Скрыт
          </span>
        )}
      </div>

      <div className={`${styles.colCategory} ${styles.cell}`}>{item.category}</div>
      <div className={`${styles.colChars} ${styles.cell}`}>{item.characteristics}</div>

      <div className={`${styles.colLink} ${styles.cell}`}>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" className={styles.link}>
            Ссылка
          </a>
        ) : (
          "—"
        )}
      </div>

      <div className={`${styles.colAuthor} ${styles.cell}`}>{item.author}</div>
      <div className={`${styles.colInstrument} ${styles.cell}`}>{item.instrument}</div>

      <div className={styles.colEdit}>
        <button className={styles.iconBtn} title="Редактировать" onClick={() => onEdit(item.id)}>
          <SquarePen size={16} />
        </button>
      </div>
    </div>
  );
}

interface PatternCardHeaderProps {
  allSelected: boolean;
  onSelectAll: (checked: boolean) => void;
}

export function PatternCardHeader({ allSelected, onSelectAll }: PatternCardHeaderProps) {
  return (
    <div className={styles.card} style={{ borderBottom: "1px solid #E5E7EB" }}>
      <div className={styles.colCheckbox}>
        <input
          type="checkbox"
          checked={allSelected}
          onChange={(e) => onSelectAll(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "#9B9A9A", cursor: "pointer" }}
        />
      </div>
      <div className={styles.colImage} />
      <div className={`${styles.colDate} ${styles.headerCell}`}>Дата</div>
      <div className={`${styles.colTitle} ${styles.headerCell}`}>Название</div>
      <div className={`${styles.colCategory} ${styles.headerCell}`}>Категория</div>
      <div className={`${styles.colChars} ${styles.headerCell}`}>Хар-ки</div>
      <div className={`${styles.colLink} ${styles.headerCell}`}>Ссылка</div>
      <div className={`${styles.colAuthor} ${styles.headerCell}`}>Автор</div>
      <div className={`${styles.colInstrument} ${styles.headerCell}`}>Инструмент</div>
      <div className={styles.colEdit} />
    </div>
  );
}
