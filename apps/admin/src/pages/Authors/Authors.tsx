import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { AuthorRow, AuthorRowHeader } from "./AuthorRow";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Button } from "../../components/Button/Button";
import { getAuthors, createAuthor, updateAuthor, deleteAuthor, AuthorItem, getSyncStatus, checkPendingAuthors, startSync, startAuthorSync } from "../../api/authors";
import { getPendingReports } from "../../api/authors";
import { Modal } from "../../components/Modal/Modal";
import { SyncModal } from "./SyncModal";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import { CabinetSection } from "./CabinetSection";
import toast from "react-hot-toast";
import { useUnread } from "../../contexts/UnreadContext";
import styles from "./Authors.module.css";

export function Authors() {
  const { refresh } = useUnread();
  const [authors, setAuthors] = useState<AuthorItem[]>([]);
  const [syncReports, setSyncReports] = useState<{ id: string; authorId: string; itemsCount: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncModalReportId, setSyncModalReportId] = useState<string | null>(null);
  const [syncModalAuthorName, setSyncModalAuthorName] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAuthor, setEditingAuthor] = useState<AuthorItem | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    site: "",
    comment: "",
    contentPermissionRequested: false,
    removalRequested: false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [authorToDelete, setAuthorToDelete] = useState<AuthorItem | null>(null);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingAuthorId, setSyncingAuthorId] = useState<string | null>(null);
  const [pendingSyncAuthors, setPendingSyncAuthors] = useState<{ isOpen: boolean; authors: string[] }>({ isOpen: false, authors: [] });

  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        const { isRunning, authorId } = await getSyncStatus();
        setIsSyncing(isRunning);
        setSyncingAuthorId(authorId);
      } catch (e) {
        console.error(e);
      }
    };
    checkInitialStatus();
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isSyncing) {
      interval = setInterval(async () => {
        try {
          const { isRunning, authorId } = await getSyncStatus();
          if (!isRunning) {
            setIsSyncing(false);
            setSyncingAuthorId(null);
            try {
              await loadAuthors();
              refresh();
              toast.success("Синхронизация завершена");
            } catch (err) {
              toast.error("Синхронизация завершена, но не удалось обновить список");
            }
          } else {
            setSyncingAuthorId(authorId);
          }
        } catch (e) {
          console.error(e);
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [isSyncing, debouncedSearchQuery]);

  const handleCheckNew = async () => {
    try {
      const { authors: pendingList } = await checkPendingAuthors();
      if (pendingList.length > 0) {
        setPendingSyncAuthors({ isOpen: true, authors: pendingList });
      } else {
        await executeStartSync();
      }
    } catch (err: any) {
      toast.error(err.message || "Ошибка проверки статуса");
    }
  };

  const executeStartSync = async () => {
    try {
      setPendingSyncAuthors({ isOpen: false, authors: [] });
      await startSync();
      setIsSyncing(true);
      setSyncingAuthorId(null);
      toast.success("Поиск новинок запущен в фоне");
    } catch (err: any) {
      toast.error(err.message || "Ошибка при запуске");
    }
  };

  const handleRunAuthorSync = async (author: AuthorItem) => {
    try {
      await startAuthorSync(author.id);
      setIsSyncing(true);
      setSyncingAuthorId(author.id);
      toast.success(`Проверка новинок для «${author.name}» запущена в фоне`);
    } catch (err: any) {
      toast.error(err.message || "Ошибка при запуске");
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    loadAuthors();
  }, [debouncedSearchQuery]);

  const loadAuthors = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [data, reports] = await Promise.all([
        getAuthors(debouncedSearchQuery),
        getPendingReports()
      ]);
      
      const reportAuthorIds = new Set(reports.map((r: any) => r.authorId));
      data.sort((a, b) => {
        const aHas = reportAuthorIds.has(a.id);
        const bHas = reportAuthorIds.has(b.id);
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        return a.name.localeCompare(b.name, "ru");
      });

      setAuthors(data);
      setSyncReports(reports);
      // Keep the open edit modal's CabinetSection in sync — it reads
      // `cabinet` off a snapshot in editingAuthor, which a fresh fetch
      // otherwise leaves stale (e.g. after granting/revoking access).
      setEditingAuthor((prev) => (prev ? data.find((a) => a.id === prev.id) ?? prev : prev));
    } catch (err: any) {
      setError(err.message || "Failed to load authors");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingAuthor(null);
    setFormData({ name: "", site: "", comment: "", contentPermissionRequested: false, removalRequested: false });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (author: AuthorItem) => {
    setEditingAuthor(author);
    setFormData({
      name: author.name,
      site: author.site ?? "",
      comment: author.comment ?? "",
      contentPermissionRequested: author.contentPermissionRequested,
      removalRequested: author.removalRequested,
    });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    try {
      setIsSaving(true);
      if (editingAuthor) {
        await updateAuthor(editingAuthor.id, {
          name: formData.name.trim(),
          site: formData.site.trim(),
          comment: formData.comment.trim() || null,
          contentPermissionRequested: formData.contentPermissionRequested,
          removalRequested: formData.removalRequested,
        });
      } else {
        await createAuthor({ name: formData.name.trim(), site: formData.site.trim() });
      }
      toast.success(editingAuthor ? "Автор обновлен" : "Автор создан");
      setIsModalOpen(false);
      await loadAuthors();
    } catch (err: any) {
      toast.error(err.message || "Failed to save author");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (author: AuthorItem) => {
    if (author.patternsCount > 0) {
      toast.error(`Невозможно удалить автора. Привязано описаний: ${author.patternsCount}`);
      return;
    }
    setAuthorToDelete(author);
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    setConfirmOpen(false);
    if (!authorToDelete) return;
    try {
      await deleteAuthor(authorToDelete.id);
      toast.success("Автор удален");
      await loadAuthors();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete author");
    } finally {
      setAuthorToDelete(null);
    }
  };

  const totalPendingCount = syncReports.reduce((sum, r) => sum + r.itemsCount, 0);

  if (isLoading && authors.length === 0) {
    return <div className={styles.centerState}>Загрузка...</div>;
  }

  if (error && authors.length === 0) {
    return (
      <div className={styles.centerState} style={{ color: "var(--danger)" }}>
        {error}
        <Button variant="secondary" onClick={loadAuthors}>
          Попробовать снова
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <PageHeader
        title="Авторы"
        search={{ value: searchQuery, onChange: setSearchQuery }}
        totalCount={{ label: "Всего авторов:", value: authors.length }}
      />

      <div className={styles.controlsPanel}>
        <div className={styles.leftControls}>
          {totalPendingCount > 0 && (
            <span className={styles.pendingCounter}>
              Найдено <span className={styles.pendingCounterValue}>{totalPendingCount}</span> новин{totalPendingCount === 1 ? "ки" : "ок"}
            </span>
          )}
        </div>
        <div className={styles.rightControls}>
          <Button
            variant="secondary"
            onClick={handleCheckNew}
            disabled={isSyncing}
            style={{ marginRight: "12px" }}
          >
            {isSyncing ? "Синхронизация..." : "Проверить новинки"}
          </Button>
          <Button icon={<Plus size={16} />} onClick={handleOpenCreate}>
            Добавить автора
          </Button>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <AuthorRowHeader />
        {authors.map((author) => {
          const report = syncReports.find(r => r.authorId === author.id);
          return (
            <AuthorRow
              key={author.id}
              author={author}
              onEdit={handleOpenEdit}
              onDelete={handleDelete}
              hasSyncReport={!!report}
              syncItemsCount={report?.itemsCount}
              onSync={() => {
                setSyncModalReportId(report!.id);
                setSyncModalAuthorName(author.name);
                setSyncModalOpen(true);
              }}
              onRunSync={handleRunAuthorSync}
              isSyncingThisAuthor={isSyncing && syncingAuthorId === author.id}
              isSyncBusy={isSyncing}
            />
          );
        })}
        {authors.length === 0 && !isLoading && (
          <div className={styles.centerState}>Авторов пока нет</div>
        )}
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={handleCloseModal} 
        title={editingAuthor ? "Редактирование автора" : "Новый автор"}
      >
        <form onSubmit={handleSave} className={styles.form}>
          <div className={styles.formGroup}>
            <label>Имя</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={styles.input}
              placeholder="Введите имя автора"
              autoFocus
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label>Сайт</label>
            <input
              type="url"
              value={formData.site}
              onChange={(e) => setFormData({ ...formData, site: e.target.value })}
              className={styles.input}
              placeholder="https://example.com"
            />
          </div>

          {editingAuthor && (
            <>
              <div className={styles.formGroup}>
                <label>Комментарий</label>
                <textarea
                  value={formData.comment}
                  onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                  className={styles.textarea}
                  rows={3}
                  placeholder="Заметки для админа, пользователям не видны"
                />
              </div>

              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={formData.contentPermissionRequested}
                  onChange={(e) => setFormData({ ...formData, contentPermissionRequested: e.target.checked })}
                />
                <span>Запросили разрешение постить их контент</span>
              </label>

              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={formData.removalRequested}
                  onChange={(e) => setFormData({ ...formData, removalRequested: e.target.checked })}
                />
                <span>Автор попросил удалить себя из Раппорта</span>
              </label>
            </>
          )}

          <div className={styles.formActions}>
            <Button variant="secondary" onClick={handleCloseModal}>
              Отмена
            </Button>
            <Button type="submit" disabled={isSaving || !formData.name.trim()}>
              {isSaving ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </form>

        {editingAuthor && (
          <CabinetSection author={editingAuthor} onChanged={loadAuthors} />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Удалить автора"
        message={`Вы уверены, что хотите удалить автора "${authorToDelete?.name || ""}"?`}
        confirmText="Удалить"
        cancelText="Отмена"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => { setConfirmOpen(false); setAuthorToDelete(null); }}
      />

      <ConfirmDialog
        isOpen={pendingSyncAuthors.isOpen}
        title="Есть необработанные новинки"
        message={`У вас есть необработанные новинки от авторов: ${pendingSyncAuthors.authors.join(", ")}. Вы уверены, что хотите запустить новую синхронизацию? Существующие данные могут обновиться.`}
        confirmText="Продолжить"
        cancelText="Отмена"
        variant="danger"
        onConfirm={executeStartSync}
        onCancel={() => setPendingSyncAuthors({ isOpen: false, authors: [] })}
      />

      <SyncModal
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        reportId={syncModalReportId}
        authorName={syncModalAuthorName}
        onSuccess={() => { loadAuthors(); refresh(); }}
      />
    </div>
  );
}
