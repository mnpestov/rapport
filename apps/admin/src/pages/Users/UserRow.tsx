import { Heart, ChevronUp, ChevronDown, SquarePen } from "lucide-react";
import { IconButton } from "../../components/Button/Button";
import { AdminUser, UserRole, SortField, SortOrder } from "../../api/users";
import styles from "./UserRow.module.css";

const ROLE_LABELS: Record<UserRole, string> = { USER: "User", AUTHOR: "Автор", ADMIN: "Admin" };
const ROLE_CLASS: Record<UserRole, string> = {
  USER: styles.roleUser,
  AUTHOR: styles.roleAuthor,
  ADMIN: styles.roleAdmin,
};

function SortIcon({ field, sortBy, sortOrder }: { field: SortField; sortBy: SortField; sortOrder: SortOrder }) {
  if (sortBy !== field) return <ChevronDown size={12} className={styles.sortInactive} />;
  return sortOrder === "asc"
    ? <ChevronUp size={12} className={styles.sortActive} />
    : <ChevronDown size={12} className={styles.sortActive} />;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fullName(u: Pick<AdminUser, "firstName" | "lastName">): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || "—";
}

// Канал последнего входа. null — пользователь не заходил после раскатки поля.
function channelLabel(channel: string | null): string {
  if (channel === "web") return "Веб";
  if (channel === "tg") return "ТГ";
  return "—";
}

// ── Header ────────────────────────────────────────────────────────────────────

interface UserRowHeaderProps {
  sortBy: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
}

export function UserRowHeader({ sortBy, sortOrder, onSort }: UserRowHeaderProps) {
  return (
    <div className={styles.header}>
      <button className={`${styles.colName} ${styles.sortable}`} onClick={() => onSort("firstName")}>
        Имя <SortIcon field="firstName" sortBy={sortBy} sortOrder={sortOrder} />
      </button>
      <span className={styles.colUsername}>Username</span>
      <span className={styles.colRole}>Роль</span>
      <span className={styles.colAuthor}>Имя автора</span>
      <button className={`${styles.colDate} ${styles.sortable}`} onClick={() => onSort("lastSeenAt")}>
        Последний вход <SortIcon field="lastSeenAt" sortBy={sortBy} sortOrder={sortOrder} />
      </button>
      <button className={`${styles.colChannel} ${styles.sortable}`} onClick={() => onSort("lastSeenChannel")}>
        Вход <SortIcon field="lastSeenChannel" sortBy={sortBy} sortOrder={sortOrder} />
      </button>
      <button className={`${styles.colFav} ${styles.sortable}`} onClick={() => onSort("favoritesCount")}>
        Избранное <SortIcon field="favoritesCount" sortBy={sortBy} sortOrder={sortOrder} />
      </button>
      <span className={styles.colEdit} />
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface UserRowProps {
  user: AdminUser;
  onClick: (user: AdminUser) => void;
  onEdit: (user: AdminUser) => void;
}

export function UserRow({ user, onClick, onEdit }: UserRowProps) {
  return (
    <div className={styles.row} onClick={() => onClick(user)}>
      <span className={`${styles.colName} ${styles.cellBold}`}>{fullName(user)}</span>
      <span className={`${styles.colUsername} ${styles.cellMuted}`}>
        {user.username ? `@${user.username}` : "—"}
      </span>
      <span className={styles.colRole}>
        <span className={ROLE_CLASS[user.role]}>{ROLE_LABELS[user.role]}</span>
      </span>
      <span className={styles.colAuthor}>
        {user.author?.name
          ? <span className={styles.cellBold}>{user.author.name}</span>
          : <span className={styles.cellMuted}>—</span>
        }
      </span>
      <span className={`${styles.colDate} ${styles.cellMuted}`}>{formatDate(user.lastSeenAt)}</span>
      <span className={styles.colChannel}>
        {user.lastSeenChannel
          ? <span className={styles.cellBold}>{channelLabel(user.lastSeenChannel)}</span>
          : <span className={styles.cellMuted}>—</span>
        }
      </span>
      <span className={styles.colFav}>
        {user.favoritesCount > 0 ? (
          <span className={styles.favCell}>
            <Heart size={16} strokeWidth={1} />
            {user.favoritesCount}
          </span>
        ) : (
          <span className={styles.cellMuted}>—</span>
        )}
      </span>
      <span className={styles.colEdit}>
        <IconButton
          title="Редактировать"
          onClick={(e) => { e.stopPropagation(); onEdit(user); }}
        >
          <SquarePen size={18} strokeWidth={1} />
        </IconButton>
      </span>
    </div>
  );
}
