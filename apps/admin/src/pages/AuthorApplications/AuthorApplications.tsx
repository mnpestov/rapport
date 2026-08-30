import { useEffect, useState } from "react";
import type { ApplicationStatus } from "@knitting/shared";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Button, IconButton } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import {
  getAuthorApplications,
  approveAuthorApplication,
  requestApplicationInfo,
  rejectAuthorApplication,
  AuthorApplication,
} from "../../api/authorApplications";
import { getAuthors, AuthorItem } from "../../api/authors";
import { generateSlug } from "../../utils/slug";
import { Check, HelpCircle, X } from "lucide-react";
import toast from "react-hot-toast";
import styles from "./AuthorApplications.module.css";

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  PENDING: "На рассмотрении",
  NEEDS_INFO: "Нужна информация",
  APPROVED: "Одобрено",
  REJECTED: "Отклонено",
};

const STATUS_OPTIONS: Array<ApplicationStatus | "ALL"> = ["PENDING", "NEEDS_INFO", "APPROVED", "REJECTED", "ALL"];

function displayName(user: AuthorApplication["user"]): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || user.telegramId;
}

export function AuthorApplications() {
  const [applications, setApplications] = useState<AuthorApplication[]>([]);
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "ALL">("PENDING");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [approveTarget, setApproveTarget] = useState<AuthorApplication | null>(null);
  const [needsInfoTarget, setNeedsInfoTarget] = useState<AuthorApplication | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AuthorApplication | null>(null);

  const load = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getAuthorApplications(statusFilter);
      setApplications(data);
    } catch (err: any) {
      setError(err.message || "Не удалось загрузить заявки");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  if (isLoading && applications.length === 0) {
    return <div className={styles.centerState}>Загрузка...</div>;
  }

  if (error && applications.length === 0) {
    return (
      <div className={styles.centerState} style={{ color: "var(--danger)" }}>
        {error}
        <Button variant="secondary" onClick={load} style={{ marginTop: 12 }}>
          Попробовать снова
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <PageHeader title="Заявки авторов" />

      <div className={styles.controlsPanel}>
        <div className={styles.filters}>
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status}
              className={[styles.filterBtn, statusFilter === status ? styles.filterBtnActive : ""].join(" ")}
              onClick={() => setStatusFilter(status)}
            >
              {status === "ALL" ? "Все" : STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Автор</th>
              <th>Пользователь</th>
              <th>Ресурсы</th>
              <th>Статус</th>
              <th>Подана</th>
              <th style={{ width: 140 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((app) => (
              <tr key={app.id} className={styles.tableRow}>
                <td className={styles.tdText}>{app.authorName}</td>
                <td className={styles.tdText}>
                  {displayName(app.user)}
                  {app.user.username && (
                    <div className={styles.tdMuted}>@{app.user.username}</div>
                  )}
                </td>
                <td className={styles.tdMuted}>
                  {app.resources.map((r, i) => (
                    <div key={i} className={styles.resourceLine} title={r}>
                      {r}
                    </div>
                  ))}
                </td>
                <td>
                  <span className={[styles.statusBadge, styles[`status${app.status}`]].join(" ")}>
                    {STATUS_LABELS[app.status]}
                  </span>
                  {app.adminComment && (app.status === "NEEDS_INFO" || app.status === "REJECTED") && (
                    <div className={styles.tdMuted} title={app.adminComment}>
                      {app.adminComment}
                    </div>
                  )}
                </td>
                <td className={styles.tdMuted}>
                  {new Date(app.createdAt).toLocaleDateString("ru-RU")}
                </td>
                <td>
                  {(app.status === "PENDING" || app.status === "NEEDS_INFO") && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <IconButton
                        title="Одобрить"
                        onClick={() => setApproveTarget(app)}
                        style={{ color: "var(--brand)" }}
                      >
                        <Check size={16} />
                      </IconButton>
                      {app.status === "PENDING" && (
                        <IconButton
                          title="Запросить информацию"
                          onClick={() => setNeedsInfoTarget(app)}
                        >
                          <HelpCircle size={16} />
                        </IconButton>
                      )}
                      <IconButton
                        title="Отклонить"
                        onClick={() => setRejectTarget(app)}
                        style={{ color: "var(--danger)" }}
                      >
                        <X size={16} />
                      </IconButton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {applications.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className={styles.centerState}>
                  Заявок нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {approveTarget && (
        <ApproveModal
          application={approveTarget}
          onClose={() => setApproveTarget(null)}
          onDone={() => {
            setApproveTarget(null);
            load();
          }}
        />
      )}

      {needsInfoTarget && (
        <NeedsInfoModal
          application={needsInfoTarget}
          onClose={() => setNeedsInfoTarget(null)}
          onDone={() => {
            setNeedsInfoTarget(null);
            load();
          }}
        />
      )}

      {rejectTarget && (
        <RejectModal
          application={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onDone={() => {
            setRejectTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ApproveModal({
  application,
  onClose,
  onDone,
}: {
  application: AuthorApplication;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [login, setLogin] = useState(generateSlug(application.authorName));
  const [createAuthorName, setCreateAuthorName] = useState(application.authorName);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AuthorItem[]>([]);
  const [selectedAuthor, setSelectedAuthor] = useState<AuthorItem | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (mode !== "existing" || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        setSearchResults(await getAuthors(searchQuery.trim()));
      } catch {
        // silent — search is a convenience, not critical
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [mode, searchQuery]);

  const handleApprove = async () => {
    if (mode === "existing" && !selectedAuthor) {
      toast.error("Выберите автора из списка");
      return;
    }
    if (mode === "new" && !createAuthorName.trim()) {
      toast.error("Укажите название автора");
      return;
    }
    if (!login.trim()) {
      toast.error("Укажите логин");
      return;
    }

    try {
      setIsSaving(true);
      const result = await approveAuthorApplication(application.id, {
        authorId: mode === "existing" ? selectedAuthor!.id : undefined,
        createAuthorName: mode === "new" ? createAuthorName.trim() : undefined,
        login: login.trim(),
      });
      toast.success(`Заявка одобрена. Логин: ${result.login}`, { duration: 6000 });
      onDone();
    } catch (err: any) {
      toast.error(err.message || "Не удалось одобрить заявку");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Одобрить заявку — ${application.authorName}`}>
      <div className={styles.form}>
        <div className={styles.tabs}>
          <button
            className={[styles.tab, mode === "new" ? styles.tabActive : ""].join(" ")}
            onClick={() => setMode("new")}
          >
            Создать автора
          </button>
          <button
            className={[styles.tab, mode === "existing" ? styles.tabActive : ""].join(" ")}
            onClick={() => setMode("existing")}
          >
            Связать с существующим
          </button>
        </div>

        {mode === "new" ? (
          <div className={styles.formGroup}>
            <label>Название автора</label>
            <input
              type="text"
              className={styles.input}
              value={createAuthorName}
              onChange={(e) => setCreateAuthorName(e.target.value)}
            />
          </div>
        ) : (
          <div className={styles.formGroup}>
            <label>Поиск автора</label>
            <input
              type="text"
              className={styles.input}
              placeholder="Начните вводить название..."
              value={selectedAuthor ? selectedAuthor.name : searchQuery}
              onChange={(e) => {
                setSelectedAuthor(null);
                setSearchQuery(e.target.value);
              }}
            />
            {isSearching && <div className={styles.tdMuted}>Поиск...</div>}
            {!selectedAuthor && searchResults.length > 0 && (
              <div className={styles.searchResults}>
                {searchResults.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={styles.searchResultItem}
                    onClick={() => {
                      setSelectedAuthor(a);
                      setSearchResults([]);
                    }}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={styles.formGroup}>
          <label>Логин</label>
          <input
            type="text"
            className={styles.input}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label>Ресурсы автора</label>
          {application.resources.map((r, i) => (
            <div key={i} className={styles.tdMuted}>{r}</div>
          ))}
        </div>

        <div className={styles.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Отмена
          </Button>
          <Button onClick={handleApprove} disabled={isSaving}>
            {isSaving ? "Одобрение..." : "Одобрить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function NeedsInfoModal({
  application,
  onClose,
  onDone,
}: {
  application: AuthorApplication;
  onClose: () => void;
  onDone: () => void;
}) {
  const [comment, setComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async () => {
    if (!comment.trim()) {
      toast.error("Укажите, что нужно уточнить");
      return;
    }
    try {
      setIsSaving(true);
      await requestApplicationInfo(application.id, comment.trim());
      toast.success("Запрос отправлен");
      onDone();
    } catch (err: any) {
      toast.error(err.message || "Не удалось отправить запрос");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Запросить информацию — ${application.authorName}`}>
      <div className={styles.form}>
        <div className={styles.formGroup}>
          <label>Что нужно уточнить</label>
          <textarea
            className={styles.textarea}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Например: приложите ссылку на подтверждение авторства"
            autoFocus
          />
        </div>
        <div className={styles.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving || !comment.trim()}>
            {isSaving ? "Отправка..." : "Отправить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RejectModal({
  application,
  onClose,
  onDone,
}: {
  application: AuthorApplication;
  onClose: () => void;
  onDone: () => void;
}) {
  const [comment, setComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async () => {
    try {
      setIsSaving(true);
      await rejectAuthorApplication(application.id, comment.trim() || undefined);
      toast.success("Заявка отклонена");
      onDone();
    } catch (err: any) {
      toast.error(err.message || "Не удалось отклонить заявку");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Отклонить заявку — ${application.authorName}`}>
      <div className={styles.form}>
        <div className={styles.formGroup}>
          <label>Причина (необязательно)</label>
          <textarea
            className={styles.textarea}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Видна пользователю в статусе заявки"
            autoFocus
          />
        </div>
        <div className={styles.formActions}>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Отмена
          </Button>
          <Button variant="danger" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? "Отклонение..." : "Отклонить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
