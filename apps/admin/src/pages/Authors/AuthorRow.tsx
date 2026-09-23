import { SquarePen, Trash2, RefreshCw, Check, Loader } from "lucide-react";
import { IconButton } from "../../components/Button/Button";
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

type SortColumn = "name" | "patternsCount";

interface AuthorRowHeaderProps {
  sortColumn?: SortColumn | null;
  sortDirection?: "asc" | "desc";
  onSort?: (column: SortColumn) => void;
}

function sortIndicator(column: SortColumn, sortColumn?: SortColumn | null, sortDirection?: "asc" | "desc") {
  if (sortColumn !== column) return null;
  return <span className={styles.sortArrow}>{sortDirection === "asc" ? "↑" : "↓"}</span>;
}

export function AuthorRowHeader({ sortColumn, sortDirection, onSort }: AuthorRowHeaderProps = {}) {
  return (
    <div className={styles.header}>
      <span
        className={onSort ? `${styles.colName} ${styles.sortable}` : styles.colName}
        onClick={onSort ? () => onSort("name") : undefined}
      >
        Имя{sortIndicator("name", sortColumn, sortDirection)}
      </span>
      <span className={styles.colSite}>Сайт</span>
      <span
        className={onSort ? `${styles.colCount} ${styles.sortable}` : styles.colCount}
        onClick={onSort ? () => onSort("patternsCount") : undefined}
      >
        Описаний{sortIndicator("patternsCount", sortColumn, sortDirection)}
      </span>
      <span className={styles.colComment}>Комментарий</span>
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
      className={[
        styles.row,
        hasSyncReport ? styles.rowClickable : "",
        // Автор попросил удаления — вся строка приглушённая.
        author.removalRequested ? styles.rowRemoval : "",
      ].filter(Boolean).join(" ")}
      onClick={handleClick}
    >
      <span className={styles.colName}>
        {author.name}
        {/* Статус связи с автором: кабинет перекрывает «запросили разрешение»
            (кабинет есть → галочка, иначе запрос отправлен → ромашка) —
            это два взаимоисключающих состояния одного процесса. Согласие на
            размещение — независимый признак, показывается ДОПОЛНИТЕЛЬНО,
            той же галочкой, но серой (не оранжевой): visually "тот же
            смысл маркера", другой процесс. */}
        {author.cabinet ? (
          <Check
            size={14}
            strokeWidth={3}
            className={styles.linkedMark}
            aria-label="За автором закреплён пользователь"
          />
        ) : author.contentPermissionRequested ? (
          <Loader
            size={15}
            strokeWidth={2}
            className={styles.permissionMark}
            aria-label="Запросили разрешение постить контент"
          />
        ) : null}
        {author.contentPermissionGranted && (
          <Check
            size={14}
            strokeWidth={3}
            className={styles.grantedMark}
            aria-label="Дал согласие на размещение"
          />
        )}
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
      <span className={styles.colComment} title={author.comment ?? undefined}>
        {author.comment || <span className={styles.commentEmpty}>—</span>}
      </span>
      <div className={styles.colActions}>
        <IconButton
          title={syncTitle}
          onClick={() => onRunSync(author)}
          disabled={syncDisabled}
          // В приглушённой строке цвет задаёт .rowRemoval — инлайн не ставим,
          // иначе он перебьёт класс.
          style={author.removalRequested ? undefined : { color: hasScrapableSite ? "var(--text)" : "var(--text-subtle)" }}
        >
          <RefreshCw size={16} className={isSyncingThisAuthor ? styles.spinning : undefined} />
        </IconButton>
        <IconButton title="Редактировать" onClick={() => onEdit(author)}>
          <SquarePen size={16} />
        </IconButton>
        <IconButton
          title="Удалить"
          onClick={() => onDelete(author)}
          disabled={author.patternsCount > 0}
          style={author.removalRequested ? undefined : { color: author.patternsCount > 0 ? "var(--text-subtle)" : "var(--danger)" }}
        >
          <Trash2 size={16} />
        </IconButton>
      </div>
    </div>
  );
}
