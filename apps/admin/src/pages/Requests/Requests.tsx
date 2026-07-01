import { useEffect, useState, useCallback } from "react";
import { Search } from "lucide-react";
import { getRequests, RequestUser } from "../../api/chat";
import { ChatPanel } from "../Whitelist/ChatPanel";
import { useUnread } from "../../contexts/UnreadContext";
import styles from "./Requests.module.css";

type Filter = "all" | "unread";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function displayName(user: RequestUser): string {
  return user.firstName || (user.username ? `@${user.username}` : user.telegramId);
}

function lastMessagePreview(user: RequestUser): string {
  if (user.lastMessageText) return user.lastMessageText;
  const labels: Record<string, string> = {
    photo: "Фото",
    voice: "Голосовое",
    audio: "Аудио",
    video: "Видео",
    video_note: "Видеосообщение",
    document: "Файл",
    sticker: "Стикер",
  };
  return labels[user.lastMessageType] ?? "Вложение";
}

export function Requests() {
  const [users, setUsers] = useState<RequestUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { allUsers: unreadSet, refresh: refreshUnread } = useUnread();

  const load = useCallback(async () => {
    try {
      const data = await getRequests();
      setUsers(data);
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = users.filter((u) => {
    if (filter === "unread" && u.unreadCount === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !u.telegramId.includes(q) &&
        !(u.firstName?.toLowerCase().includes(q)) &&
        !(u.username?.toLowerCase().includes(q))
      )
        return false;
    }
    return true;
  });

  const selectedUser = users.find((u) => u.telegramId === selectedId) ?? null;
  const unreadCount = users.filter((u) => u.unreadCount > 0).length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Обращения</h1>
        <div className={styles.searchWrapper}>
          <input
            type="text"
            placeholder="Поиск по ID, имени, username"
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Search size={18} color="#9ca3af" />
        </div>
      </div>

      <div className={styles.tabsContainer}>
        <button
          className={filter === "all" ? styles.tabActive : styles.tab}
          onClick={() => setFilter("all")}
        >
          Все
        </button>
        <button
          className={filter === "unread" ? styles.tabActive : styles.tab}
          onClick={() => setFilter("unread")}
        >
          Непрочитанные
          {unreadCount > 0 && (
            <span className={styles.tabBadge}>{unreadCount}</span>
          )}
        </button>
      </div>

      <div className={styles.layout}>
        <div className={styles.userList}>
          {isLoading && <div className={styles.empty}>Загрузка...</div>}
          {!isLoading && filtered.length === 0 && (
            <div className={styles.empty}>Нет обращений</div>
          )}
          {filtered.map((user) => {
            const isUnread = unreadSet.has(user.telegramId);
            const isSelected = selectedId === user.telegramId;
            return (
              <div
                key={user.telegramId}
                className={`${styles.userCard} ${isSelected ? styles.userCardSelected : ""}`}
                onClick={() => setSelectedId(user.telegramId)}
              >
                <div className={styles.cardTop}>
                  <span className={styles.cardName}>
                    {displayName(user)}
                    {isUnread && <span className={styles.unreadDot} />}
                  </span>
                  <span className={styles.cardTime}>{formatTime(user.lastMessageAt)}</span>
                </div>
                <div className={styles.cardBottom}>
                  <span className={styles.cardPreview}>{lastMessagePreview(user)}</span>
                  {user.unreadCount > 0 && (
                    <span className={styles.unreadBadge}>{user.unreadCount}</span>
                  )}
                </div>
                {user.isWhitelisted && (
                  <span className={styles.whitelistTag} title="В белом списке">WL</span>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.chatArea}>
          {selectedUser ? (
            <ChatPanel
              key={selectedUser.telegramId}
              telegramId={selectedUser.telegramId}
              displayName={displayName(selectedUser)}
              onRead={() => {
                load();
                refreshUnread();
              }}
            />
          ) : (
            <div className={styles.chatEmpty}>
              Выберите пользователя, чтобы открыть чат
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
