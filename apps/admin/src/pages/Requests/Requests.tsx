import { useEffect, useState, useCallback } from "react";
import { Tabs } from "../../components/Tabs/Tabs";
import {
  getRequests,
  RequestUser,
  getWinbackResponses,
  WinbackSendItem,
  WinbackResponseInfo,
  markWinbackResponseAsRead,
} from "../../api/chat";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { ChatPanel } from "../Whitelist/ChatPanel";
import { useUnread } from "../../contexts/UnreadContext";
import styles from "./Requests.module.css";

type Filter = "all" | "unread" | "winback";

const WINBACK_REASON_LABEL: Record<WinbackResponseInfo["reason"], string> = {
  DIDNT_FIND_PATTERN: "Не нашла описание",
  HARD_TO_USE: "Сложно пользоваться",
  ALL_GOOD: "Всё хорошо",
};

const WINBACK_REASON_CLASS: Record<WinbackResponseInfo["reason"], string> = {
  DIDNT_FIND_PATTERN: "winbackReasonDidntFind",
  HARD_TO_USE: "winbackReasonHardToUse",
  ALL_GOOD: "winbackReasonAllGood",
};

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
  const { allUsers: unreadSet, winbackUnreadCount, refresh: refreshUnread } = useUnread();

  const [winbackItems, setWinbackItems] = useState<WinbackSendItem[]>([]);
  const [winbackLoading, setWinbackLoading] = useState(false);
  // Подфильтр внутри вкладки Winback — список отправок легко разрастается
  // до сотен строк, а отвечает обычно малая доля, без фильтра приходится
  // долго скроллить в поисках ответивших.
  const [winbackSubFilter, setWinbackSubFilter] = useState<"all" | "answered">("all");

  const loadWinback = useCallback(async () => {
    setWinbackLoading(true);
    try {
      const data = await getWinbackResponses();
      setWinbackItems(data);
    } catch {
      // silent — тот же паттерн, что у load() выше
    } finally {
      setWinbackLoading(false);
    }
  }, []);

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

  // Winback грузится только при активной вкладке — не нужен на остальных
  // двух, не гоняем лишний запрос каждые 20с фоном.
  useEffect(() => {
    if (filter !== "winback") return;
    loadWinback();
  }, [filter, loadWinback]);

  const handleOpenWinbackResponse = async (item: WinbackSendItem) => {
    if (!item.response || item.response.isRead) return;
    // Оптимистично — тот же UX, что и у обычных обращений (открыл чат →
    // сразу пропала точка, не дожидаясь ответа сервера).
    setWinbackItems((prev) =>
      prev.map((i) =>
        i.userId === item.userId && i.response
          ? { ...i, response: { ...i.response, isRead: true } }
          : i
      )
    );
    try {
      await markWinbackResponseAsRead(item.response.id);
      refreshUnread();
    } catch {
      // silent — как и остальные мутации на этой странице; следующий
      // poll refreshUnread всё равно подтянет реальное состояние
    }
  };

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
      <PageHeader
        title="Обращения"
        search={{ value: search, onChange: setSearch, placeholder: "Поиск по ID, имени, username" }}
      />

      <Tabs
        tabs={[
          { value: "all", label: "Все" },
          // Счётчик показываем, только когда есть что считать: «Непрочитанные (0)»
          // выглядит как ошибка загрузки.
          { value: "unread", label: "Непрочитанные", ...(unreadCount > 0 ? { count: unreadCount } : {}) },
          { value: "winback", label: "Winback", ...(winbackUnreadCount > 0 ? { count: winbackUnreadCount } : {}) },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        mobileLabel="Показывать"
      />

      {filter === "winback" ? (
        <div className={styles.layout}>
          <div className={styles.winbackList}>
            {winbackLoading && <div className={styles.empty}>Загрузка...</div>}
            {!winbackLoading && winbackItems.length === 0 && (
              <div className={styles.empty}>Пока никому не отправлен winback-чекин</div>
            )}
            {!winbackLoading && winbackItems.length > 0 && (
              <div className={styles.winbackSummary}>
                <span>
                  Отправлено <strong>{winbackItems.length}</strong>, ответили{" "}
                  <strong>{winbackItems.filter((i) => i.response).length}</strong>
                  {" "}({Math.round((winbackItems.filter((i) => i.response).length / winbackItems.length) * 100)}%)
                </span>
                <div className={styles.winbackSubFilter}>
                  <button
                    type="button"
                    className={winbackSubFilter === "all" ? styles.winbackSubFilterActive : styles.winbackSubFilterBtn}
                    onClick={() => setWinbackSubFilter("all")}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    className={winbackSubFilter === "answered" ? styles.winbackSubFilterActive : styles.winbackSubFilterBtn}
                    onClick={() => setWinbackSubFilter("answered")}
                  >
                    Ответили
                  </button>
                </div>
              </div>
            )}
            {winbackItems
              .filter((item) => winbackSubFilter === "all" || !!item.response)
              .map((item) => {
              const isUnread = !!item.response && !item.response.isRead;
              return (
                <div
                  key={item.userId}
                  className={`${styles.winbackCard} ${item.response ? styles.winbackCardClickable : ""}`}
                  onClick={() => handleOpenWinbackResponse(item)}
                >
                  <div className={styles.winbackTop}>
                    <span className={styles.winbackName}>
                      {item.firstName || (item.username ? `@${item.username}` : item.telegramId)}
                      {isUnread && <span className={styles.unreadDot} />}
                    </span>
                    <span className={styles.winbackTime}>
                      {formatTime(item.response?.createdAt ?? item.sentAt)}
                    </span>
                  </div>
                  <div className={styles.cardTgId}>{item.telegramId}</div>
                  <div className={styles.winbackStatusRow}>
                    <span className={styles.winbackSentLabel}>
                      Чекин отправлен {formatTime(item.sentAt)}
                    </span>
                    {item.optedOut && (
                      <span className={`${styles.winbackReason} ${styles.winbackReasonOptOut}`}>
                        {item.optOutReason === "UNREACHABLE" ? "Заблокировал бота" : "Отказался от рассылки"}
                      </span>
                    )}
                  </div>
                  {item.response ? (
                    <>
                      <span className={`${styles.winbackReason} ${styles[WINBACK_REASON_CLASS[item.response.reason]]}`}>
                        {WINBACK_REASON_LABEL[item.response.reason]}
                      </span>
                      {item.response.feedbackText ? (
                        <div className={styles.winbackFeedback}>{item.response.feedbackText}</div>
                      ) : (
                        item.response.reason !== "ALL_GOOD" && (
                          <div className={styles.winbackNoFeedback}>Текст не оставлен</div>
                        )
                      )}
                    </>
                  ) : (
                    !item.optedOut && (
                      <div className={styles.winbackNoFeedback}>Пока не ответил(а)</div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={`${styles.userList} ${selectedId ? styles.mobileHidden : ""}`}>
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
                  <div className={styles.cardTgId}>{user.telegramId}</div>
                  {user.isSubscribed !== null && (
                    <div
                      className={user.isSubscribed ? styles.subTagSubscribed : styles.subTagNotSubscribed}
                    >
                      {user.isSubscribed ? "✓ Подписан" : "✗ Не подписан"}
                    </div>
                  )}
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

          <div className={`${styles.chatArea} ${!selectedId ? styles.mobileHidden : ""}`}>
            {selectedUser ? (
              <ChatPanel
                key={selectedUser.telegramId}
                telegramId={selectedUser.telegramId}
                displayName={displayName(selectedUser)}
                onRead={() => {
                  load();
                  refreshUnread();
                }}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <div className={styles.chatEmpty}>
                Выберите пользователя, чтобы открыть чат
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
