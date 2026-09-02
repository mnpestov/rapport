import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "../../components/Button/Button";
import { } from "lucide-react";
import { UserRow, UserRowHeader } from "./UserRow";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Modal } from "../../components/Modal/Modal";
import { getUsers, getUserSubscription, updateUser, syncPermission, AdminUser, AdminUserDetail, UserRole, SortField, SortOrder, UserFilter } from "../../api/users";
import { getAuthors, AuthorItem } from "../../api/authors";
import { ControlPanel } from "../../components/ControlPanel/ControlPanel";
import toast from "react-hot-toast";
import styles from "./Users.module.css";

const LIMIT = 50;


function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fullName(u: Pick<AdminUser, "firstName" | "lastName">): string {
  const parts = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return parts || "—";
}

function platformLabel(platform: string | null): string {
  if (!platform) return "—";
  const map: Record<string, string> = { ios: "iOS", android: "Android", tdesktop: "Desktop", web: "Web" };
  return map[platform.toLowerCase()] ?? platform;
}

// ── Toggle switch — off=grey, on=accent, used for premium permission rows ──────

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.toggleSwitch}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.toggleSlider} />
    </label>
  );
}

// ── Permission section — editable role + author link ──────────────────────────

function PermissionsSection({
  user,
  onSaved,
}: {
  user: AdminUserDetail;
  onSaved: (role: UserRole, authorId: string | null, authorName: string | null) => void;
}) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [premiumCore, setPremiumCore] = useState(user.permissions.includes("PREMIUM_CORE"));
  const [premiumDetails, setPremiumDetails] = useState(user.permissions.includes("PREMIUM_DETAILS"));
  const [premiumExtra, setPremiumExtra] = useState(user.permissions.includes("PREMIUM_EXTRA"));
  const [webAccess, setWebAccess] = useState(user.permissions.includes("WEB_ACCESS"));
  const [excludeFromStats, setExcludeFromStats] = useState(user.excludeFromStats);
  const [authorId, setAuthorId] = useState<string | null>(user.authorId);
  const [authorName, setAuthorName] = useState<string>(user.author?.name ?? "");
  const [authorSearch, setAuthorSearch] = useState(user.author?.name ?? "");
  const [allAuthors, setAllAuthors] = useState<AuthorItem[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (role === "AUTHOR") {
      getAuthors().then(setAllAuthors).catch(() => { });
    }
  }, [role]);

  const filteredAuthors = allAuthors.filter((a) =>
    a.name.toLowerCase().includes(authorSearch.toLowerCase())
  );

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (newRole !== "AUTHOR") {
      setAuthorId(null);
      setAuthorName("");
      setAuthorSearch("");
    }
  };

  const handleSelectAuthor = (a: AuthorItem) => {
    setAuthorId(a.id);
    setAuthorName(a.name);
    setAuthorSearch(a.name);
    setShowDropdown(false);
  };

  const handleSave = async () => {
    if (role === "AUTHOR" && !authorId) {
      toast.error("Выберите автора");
      return;
    }
    setIsSaving(true);
    try {
      await updateUser(user.id, {
        role,
        authorId: role === "AUTHOR" ? authorId : null,
        excludeFromStats,
      });
      await syncPermission(user.id, "PREMIUM_CORE", premiumCore, user.permissions.includes("PREMIUM_CORE"));
      await syncPermission(user.id, "PREMIUM_DETAILS", premiumDetails, user.permissions.includes("PREMIUM_DETAILS"));
      await syncPermission(user.id, "PREMIUM_EXTRA", premiumExtra, user.permissions.includes("PREMIUM_EXTRA"));
      // Снятие WEB_ACCESS на бэкенде заодно завершает браузерные сессии
      // пользователя — иначе он работал бы до истечения токена (до 30 дней).
      await syncPermission(user.id, "WEB_ACCESS", webAccess, user.permissions.includes("WEB_ACCESS"));
      toast.success("Разрешения обновлены");
      onSaved(role, role === "AUTHOR" ? authorId : null, role === "AUTHOR" ? authorName : null);
    } catch (err: any) {
      toast.error(err.message || "Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  };

  const isDirty = role !== user.role || authorId !== user.authorId
    || premiumCore !== user.permissions.includes("PREMIUM_CORE")
    || premiumDetails !== user.permissions.includes("PREMIUM_DETAILS")
    || premiumExtra !== user.permissions.includes("PREMIUM_EXTRA")
    || webAccess !== user.permissions.includes("WEB_ACCESS")
    || excludeFromStats !== user.excludeFromStats;

  return (
    <div className={styles.permissionsSection}>
      <div className={styles.sectionTitle}>Разрешения</div>

      <div className={styles.permRow}>
        <span className={styles.rowLabel}>Роль</span>
        <select
          className={styles.roleSelect}
          value={role}
          onChange={(e) => handleRoleChange(e.target.value as UserRole)}
        >
          <option value="USER">User</option>
          <option value="AUTHOR">Author</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>

      <div className={styles.permRow}>
        <span className={styles.rowLabel}>Плотность и толщина пряжи</span>
        <ToggleSwitch checked={premiumCore} onChange={setPremiumCore} />
      </div>
      <div className={styles.permRow}>
        <span className={styles.rowLabel}>Подробности</span>
        <ToggleSwitch checked={premiumDetails} onChange={setPremiumDetails} />
      </div>
      <div className={styles.permRow}>
        <span className={styles.rowLabel}>Максимальный</span>
        <ToggleSwitch checked={premiumExtra} onChange={setPremiumExtra} />
      </div>

      {/* Вход в браузерную версию на rapport.su. Выдаётся автоматически,
          когда человек получает логин в боте; здесь — ручное управление.
          Выключение отзывает и активные браузерные сессии. Авторам доступ
          даёт AUTHOR_CABINET, этот тумблер им не нужен. */}
      <div className={styles.permRow}>
        <span className={styles.rowLabel}>Доступ в браузере</span>
        <ToggleSwitch checked={webAccess} onChange={setWebAccess} />
      </div>

      {/* Не разрешение, а отметка "это наш/тестовый аккаунт" — влияет
          только на воронку подписки, доступа не меняет. Стоит в этом же
          блоке, потому что редактируется там же, где роль. */}
      <div className={styles.permRow}>
        <span className={styles.rowLabel}>Не учитывать в статистике</span>
        <ToggleSwitch checked={excludeFromStats} onChange={setExcludeFromStats} />
      </div>

      {role === "AUTHOR" && (
        <div className={styles.permRow}>
          <span className={styles.rowLabel}>Автор</span>
          <div className={styles.authorSearchWrap}>
            <input
              className={styles.authorSearchInput}
              placeholder="Поиск автора..."
              value={authorSearch}
              onChange={(e) => {
                setAuthorSearch(e.target.value);
                setAuthorId(null);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {showDropdown && filteredAuthors.length > 0 && (
              <ul className={styles.authorDropdown}>
                {filteredAuthors.slice(0, 8).map((a) => (
                  <li
                    key={a.id}
                    className={styles.authorDropdownItem}
                    onMouseDown={() => handleSelectAuthor(a)}
                  >
                    {a.name}
                    <span className={styles.authorDropdownCount}>{a.patternsCount}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {isDirty && (
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Сохранение..." : "Сохранить"}
        </Button>
      )}
    </div>
  );
}

// ── User cart modal ────────────────────────────────────────────────────────────

function UserModal({
  user: initialUser,
  onClose,
  onUserUpdated,
}: {
  user: AdminUser;
  onClose: () => void;
  onUserUpdated: (id: string, role: UserRole, authorId: string | null, authorName: string | null) => void;
}) {
  const [subStatus, setSubStatus] = useState<boolean | null | "loading">("loading");
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);

  useEffect(() => {
    getUserSubscription(initialUser.telegramId).then(setSubStatus);
    // Load full user detail for permissions section
    import("../../api/users").then(({ getUserById }) =>
      getUserById(initialUser.id).then(setDetail).catch(() => { })
    );
  }, [initialUser.id, initialUser.telegramId]);

  return (
    <Modal isOpen onClose={onClose} title={fullName(initialUser)} maxWidth={560}>
      <div className={styles.modalBody}>
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Основное</div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Telegram ID</span>
            <span className={styles.rowValue}>{initialUser.telegramId}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Username</span>
            <span className={initialUser.username ? styles.rowValue : styles.rowValueMuted}>
              {initialUser.username ? `@${initialUser.username}` : "—"}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Язык</span>
            <span className={initialUser.languageCode ? styles.rowValue : styles.rowValueMuted}>
              {initialUser.languageCode ?? "—"}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Telegram Premium</span>
            <span className={styles.rowValue}>{initialUser.isPremium ? "Да" : "Нет"}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Зарегистрирован</span>
            <span className={styles.rowValue}>{formatDate(initialUser.createdAt)}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Последний вход</span>
            <span className={initialUser.lastSeenAt ? styles.rowValue : styles.rowValueMuted}>
              {formatDate(initialUser.lastSeenAt)}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Канал входа</span>
            <span className={initialUser.lastSeenChannel ? styles.rowValue : styles.rowValueMuted}>
              {initialUser.lastSeenChannel === "web" ? "Веб"
                : initialUser.lastSeenChannel === "tg" ? "Telegram"
                : "—"}
            </span>
          </div>
        </div>

        <div className={styles.divider} />

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Устройство</div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Платформа</span>
            <span className={initialUser.platform ? styles.rowValue : styles.rowValueMuted}>
              {platformLabel(initialUser.platform)}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Версия Telegram</span>
            <span className={initialUser.tgVersion ? styles.rowValue : styles.rowValueMuted}>
              {initialUser.tgVersion ?? "—"}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>User Agent</span>
            <span className={initialUser.userAgent ? styles.rowValue : styles.rowValueMuted}>
              {initialUser.userAgent ?? "—"}
            </span>
          </div>
        </div>

        <div className={styles.divider} />

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Каталог</div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Избранное</span>
            <span className={styles.rowValue}>{initialUser.favoritesCount}</span>
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

        <div className={styles.divider} />

        {detail ? (
          <PermissionsSection
            user={detail}
            onSaved={(role, authorId, authorName) => {
              onUserUpdated(initialUser.id, role, authorId, authorName);
            }}
          />
        ) : (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Разрешения</div>
            <div className={styles.rowValueMuted} style={{ fontSize: 13 }}>Загрузка...</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<{ all: number; paid: number; web: number }>({ all: 0, paid: 0, web: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<SortField>("lastSeenAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [filter, setFilter] = useState<UserFilter>("all");
  const [selected, setSelected] = useState<AdminUser | null>(null);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (q: string, off: number, by: SortField, order: SortOrder, tab: UserFilter) => {
      setIsLoading(true);
      try {
        const res = await getUsers({
          search: q || undefined,
          limit: LIMIT,
          offset: off,
          sortBy: by,
          sortOrder: order,
          filter: tab,
        });
        setUsers(res.data);
        setTotal(res.total);
        setCounts(res.counts);
      } catch {
        // silent
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(search, offset, sortBy, sortOrder, filter);
  }, [offset, sortBy, sortOrder, filter]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setOffset(0);
      load(value, 0, sortBy, sortOrder, filter);
    }, 300);
  };

  const handleSort = (field: SortField) => {
    const newOrder = sortBy === field && sortOrder === "desc" ? "asc" : "desc";
    setSortBy(field);
    setSortOrder(newOrder);
    setOffset(0);
  };

  const handleFilterChange = (value: string) => {
    setFilter(value as UserFilter);
    setOffset(0);
  };

  const handleUserUpdated = (id: string, role: UserRole, authorId: string | null, authorName: string | null) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id !== id
          ? u
          : {
            ...u,
            role,
            authorId,
            author: authorId && authorName ? { id: authorId, name: authorName } : null,
          }
      )
    );
  };

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className={styles.container}>
      <PageHeader
        title="Пользователи"
        search={{ value: search, onChange: handleSearchChange }}
        totalCount={total > 0 ? { label: "Всего пользователей:", value: total } : undefined}
      />

      <ControlPanel
        tabs={[
          { value: "all", label: "Все", count: counts.all },
          { value: "paid", label: "Платные", count: counts.paid },
          { value: "web", label: "Доступ в веб", count: counts.web },
        ]}
        activeTab={filter}
        onTabChange={handleFilterChange}
      />

      <div className={styles.tableWrapper}>
        <UserRowHeader sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
        {isLoading && (
          <div style={{ textAlign: "center", color: "var(--text-subtle)", padding: "32px" }}>Загрузка...</div>
        )}
        {!isLoading && users.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-subtle)", padding: "32px" }}>Пользователи не найдены</div>
        )}
        {!isLoading && users.map((u) => (
          <UserRow key={u.id} user={u} onClick={setSelected} onEdit={setSelected} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <span>{total} пользователей</span>
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            ← Назад
          </Button>
          <span>{currentPage} / {totalPages}</span>
          <Button
            variant="secondary"
            disabled={offset + LIMIT >= total}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Вперёд →
          </Button>
        </div>
      )}

      {selected && (
        <UserModal
          user={selected}
          onClose={() => setSelected(null)}
          onUserUpdated={(id, role, authorId, authorName) => {
            handleUserUpdated(id, role, authorId, authorName);
            setSelected((prev) =>
              prev && prev.id === id
                ? {
                  ...prev,
                  role,
                  authorId,
                  author: authorId && authorName ? { id: authorId, name: authorName } : null,
                }
                : prev
            );
          }}
        />
      )}
    </div>
  );
}
