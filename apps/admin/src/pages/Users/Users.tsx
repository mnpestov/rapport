import { useEffect, useState, useCallback, useRef } from "react";
import { Search, X, Heart, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { getUsers, getUserSubscription, AdminUser, SortField, SortOrder } from "../../api/users";
import styles from "./Users.module.css";

const LIMIT = 50;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fullName(u: AdminUser): string {
  const parts = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return parts || "—";
}

function platformLabel(platform: string | null): string {
  if (!platform) return "—";
  const map: Record<string, string> = { ios: "iOS", android: "Android", tdesktop: "Desktop", web: "Web" };
  return map[platform.toLowerCase()] ?? platform;
}

function UserModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [subStatus, setSubStatus] = useState<boolean | null | "loading">("loading");

  useEffect(() => {
    getUserSubscription(user.telegramId).then(setSubStatus);
  }, [user.telegramId]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalName}>{fullName(user)}</span>
          <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Основное</div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Telegram ID</span>
              <span className={styles.rowValue}>{user.telegramId}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Username</span>
              <span className={user.username ? styles.rowValue : styles.rowValueMuted}>
                {user.username ? `@${user.username}` : "—"}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Язык</span>
              <span className={user.languageCode ? styles.rowValue : styles.rowValueMuted}>
                {user.languageCode ?? "—"}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Telegram Premium</span>
              <span className={styles.rowValue}>{user.isPremium ? "Да" : "Нет"}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Зарегистрирован</span>
              <span className={styles.rowValue}>{formatDate(user.createdAt)}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Последний вход</span>
              <span className={user.lastSeenAt ? styles.rowValue : styles.rowValueMuted}>
                {formatDate(user.lastSeenAt)}
              </span>
            </div>
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Устройство</div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Платформа</span>
              <span className={user.platform ? styles.rowValue : styles.rowValueMuted}>
                {platformLabel(user.platform)}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Версия Telegram</span>
              <span className={user.tgVersion ? styles.rowValue : styles.rowValueMuted}>
                {user.tgVersion ?? "—"}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>User Agent</span>
              <span className={user.userAgent ? styles.rowValue : styles.rowValueMuted}>
                {user.userAgent ?? "—"}
              </span>
            </div>
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Каталог</div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Избранное</span>
              <span className={styles.rowValue}>{user.favoritesCount}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Подписка на канал</span>
              {subStatus === "loading" ? (
                <span className={styles.subStatusLoading}>Проверяем...</span>
              ) : subStatus === true ? (
                <span className={styles.subStatusYes}>✓ Подписан</span>
              ) : subStatus === false ? (
                <span className={styles.subStatusNo}>✗ Не подписан</span>
              ) : (
                <span className={styles.rowValueMuted}>Не удалось проверить</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SortIcon({ field, sortBy, sortOrder }: { field: SortField; sortBy: SortField; sortOrder: SortOrder }) {
  if (sortBy !== field) return <ChevronsUpDown size={13} className={styles.sortIconInactive} />;
  return sortOrder === "asc"
    ? <ChevronUp size={13} className={styles.sortIconActive} />
    : <ChevronDown size={13} className={styles.sortIconActive} />;
}

export function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<SortField>("lastSeenAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selected, setSelected] = useState<AdminUser | null>(null);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string, off: number, by: SortField, order: SortOrder) => {
    setIsLoading(true);
    try {
      const res = await getUsers({ search: q || undefined, limit: LIMIT, offset: off, sortBy: by, sortOrder: order });
      setUsers(res.data);
      setTotal(res.total);
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(search, offset, sortBy, sortOrder);
  }, [offset, sortBy, sortOrder]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setOffset(0);
      load(value, 0, sortBy, sortOrder);
    }, 300);
  };

  const handleSort = (field: SortField) => {
    const newOrder = sortBy === field && sortOrder === "desc" ? "asc" : "desc";
    setSortBy(field);
    setSortOrder(newOrder);
    setOffset(0);
  };

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Пользователи</h1>
        <div className={styles.searchWrapper}>
          <input
            type="text"
            placeholder="Поиск по имени, username, ID"
            className={styles.searchInput}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          <Search size={18} color="#9ca3af" />
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table>
          <thead>
            <tr>
              <th className={styles.thSortable} onClick={() => handleSort("firstName")}>
                Имя <SortIcon field="firstName" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
              <th>Username</th>
              <th>Telegram ID</th>
              <th>Платформа</th>
              <th className={styles.thSortable} onClick={() => handleSort("lastSeenAt")}>
                Последний вход <SortIcon field="lastSeenAt" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
              <th className={styles.thSortable} onClick={() => handleSort("favoritesCount")}>
                Избранное <SortIcon field="favoritesCount" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "#9ca3af", padding: "32px" }}>
                  Загрузка...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "#9ca3af", padding: "32px" }}>
                  Пользователи не найдены
                </td>
              </tr>
            ) : users.map((u) => (
              <tr key={u.id} onClick={() => setSelected(u)}>
                <td>
                  <div className={styles.cellName}>{fullName(u)}</div>
                </td>
                <td className={styles.cellMuted}>
                  {u.username ? `@${u.username}` : "—"}
                </td>
                <td className={styles.cellMuted}>{u.telegramId}</td>
                <td className={styles.cellMuted}>{platformLabel(u.platform)}</td>
                <td className={styles.cellMuted}>{formatDate(u.lastSeenAt)}</td>
                <td>
                  {u.favoritesCount > 0 ? (
                    <span className={styles.favCount}>
                      <Heart size={13} />
                      {u.favoritesCount}
                    </span>
                  ) : (
                    <span className={styles.cellMuted}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <span>{total} пользователей</span>
          <button
            className={styles.pageBtn}
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            ← Назад
          </button>
          <span>{currentPage} / {totalPages}</span>
          <button
            className={styles.pageBtn}
            disabled={offset + LIMIT >= total}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Вперёд →
          </button>
        </div>
      )}

      {selected && <UserModal user={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
