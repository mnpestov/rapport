import { SquarePen, Trash2, RefreshCw } from "lucide-react";
import { AuthorItem } from "../../api/authors";
import styles from "./AuthorRow.module.css";

// Mirrors the exclusion list author_sync.py applies when picking authors to
// crawl — these "sites" are just social links, not scrapable product pages.
const SOCIAL_SITE_PATTERN = /t\.me|vk\.com|instagram\.com/i;

interface AuthorRowProps {
  author: AuthorItem;
  hasSyncReport?: boolean;
  syncItemsCount?: number;
  onSync?: () => void;
  onEdit: (author: AuthorItem) => void;
  onDelete: (author: AuthorItem) => void;
  onRunSync: (author: AuthorItem) => void;
  isSyncingThisAuthor: boolean;
  isSyncBusy: boolean;
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

export function AuthorRow({ author, hasSyncReport, syncItemsCount, onSync, onEdit, onDelete, onRunSync, isSyncingThisAuthor, isSyncBusy }: AuthorRowProps) {
  const handleClick = (e: React.MouseEvent) => {
    // Stop if clicking on a button or link
    if ((e.target as HTMLElement).closest("button, a")) return;
    if (hasSyncReport && onSync) {
      onSync();
    }
  };

  const hasScrapableSite = !!author.site && !SOCIAL_SITE_PATTERN.test(author.site);
  const syncDisabled = !hasScrapableSite || (isSyncBusy && !isSyncingThisAuthor);
  const syncTitle = !hasScrapableSite
    ? "У автора нет сайта для проверки новинок"
    : isSyncingThisAuthor
      ? "Идёт проверка новинок..."
      : isSyncBusy
        ? "Дождитесь завершения текущей синхронизации"
        : "Проверить новинки";

  return (
    <div 
      className={`${styles.row} ${hasSyncReport ? styles.rowClickable : ""}`} 
      onClick={handleClick}
    >
      <span className={styles.colName}>
        {author.name}
        {hasSyncReport && <span className={styles.unreadDot}>{syncItemsCount || 0}</span>}
      </span>
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
        <button
          className={styles.iconBtn}
          title={syncTitle}
          onClick={() => onRunSync(author)}
          disabled={syncDisabled}
          style={{ color: hasScrapableSite ? "#1D1C1C" : "#9ca3af" }}
        >
          <RefreshCw size={16} className={isSyncingThisAuthor ? styles.spinning : undefined} />
        </button>
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
