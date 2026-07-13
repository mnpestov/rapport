import { SquarePen, Trash2 } from "lucide-react";
import { AuthorItem } from "../../api/authors";
import styles from "./AuthorRow.module.css";

interface AuthorRowProps {
  author: AuthorItem;
  onEdit: (author: AuthorItem) => void;
  onDelete: (author: AuthorItem) => void;
}

export function AuthorRowHeader() {
  return (
    <div className={styles.header}>
      <span className={styles.colName}>Имя</span>
      <span className={styles.colSite}>Сайт</span>
      <span className={styles.colCount}>Описаний</span>
      <span className={styles.colActions} />
    </div>
  );
}

export function AuthorRow({ author, onEdit, onDelete }: AuthorRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.colName}>{author.name}</span>
      <span className={styles.colSite}>
        {author.site ? (
          <a href={author.site} target="_blank" rel="noreferrer" className={styles.siteLink}>
            {author.site}
          </a>
        ) : (
          <span className={styles.siteEmpty}>—</span>
        )}
      </span>
      <span className={styles.colCount}>{author.patternsCount}</span>
      <div className={styles.colActions}>
        <button className={styles.iconBtn} title="Редактировать" onClick={() => onEdit(author)}>
          <SquarePen size={16} />
        </button>
        <button
          className={styles.iconBtn}
          title="Удалить"
          onClick={() => onDelete(author)}
          disabled={author.patternsCount > 0}
          style={{ color: author.patternsCount > 0 ? "#9ca3af" : "#ef4444" }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
