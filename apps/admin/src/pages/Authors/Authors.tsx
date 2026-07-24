import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { AuthorRow, AuthorRowHeader } from "./AuthorRow";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { getAuthors, createAuthor, updateAuthor, deleteAuthor, AuthorItem, getSyncStatus, checkPendingAuthors, startSync } from "../../api/authors";
import { getPendingReports } from "../../api/authors";
import { Modal } from "../../components/Modal/Modal";
import { SyncModal } from "./SyncModal";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import toast from "react-hot-toast";
import styles from "./Authors.module.css";

export function Authors() {
  const [authors, setAuthors] = useState<AuthorItem[]>([]);
  const [syncReports, setSyncReports] = useState<{ id: string; authorId: string; itemsCount: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncModalReportId, setSyncModalReportId] = useState<string | null>(null);
  const [syncModalAuthorName, setSyncModalAuthorName] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAuthor, setEditingAuthor] = useState<AuthorItem | null>(null);
  const [formData, setFormData] = useState({ name: "", site: "" });
  const [isSaving, setIsSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [authorToDelete, setAuthorToDelete] = useState<AuthorItem | null>(null);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncAuthors, setPendingSyncAuthors] = useState<{ isOpen: boolean; authors: string[] }>({ isOpen: false, authors: [] });

  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        const { isRunning } = await getSyncStatus();
        setIsSyncing(isRunning);
      } catch (e) {
        console.error(e);
      }
    };
    checkInitialStatus();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isSyncing) {
      interval = setInterval(async () => {
        try {
          const { isRunning } = await getSyncStatus();
          if (!isRunning) {
            setIsSyncing(false);
            try {
              await loadAuthors();
              toast.success("Синхронизация завершена");
            } catch (err) {
              toast.error("Синхронизация завершена, но не удалось обновить список");
            }
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
      toast.success("Поиск новинок запущен в фоне");
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
      setAuthors(data);
      setSyncReports(reports);
    } catch (err: any) {
      setError(err.message || "Failed to load authors");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingAuthor(null);
    setFormData({ name: "", site: "" });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (author: AuthorItem) => {
    setEditingAuthor(author);
    setFormData({ name: author.name, site: author.site ?? "" });
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
      const payload = { name: formData.name.trim(), site: formData.site.trim() };
      if (editingAuthor) {
        await updateAuthor(editingAuthor.id, payload);
      } else {
        await createAuthor(payload);
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

  if (isLoading && authors.length === 0) {
    return <div className={styles.centerState}>Загрузка...</div>;
  }

  if (error && authors.length === 0) {
    return (
      <div className={styles.centerState} style={{ color: "#ef4444" }}>
        {error}
        <button className={styles.btnSecondary} onClick={loadAuthors}>
          Попробовать снова
        </button>
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
        <div className={styles.leftControls}></div>
        <div className={styles.rightControls}>
          <button 
            className={styles.btnSecondary} 
            onClick={handleCheckNew}
            disabled={isSyncing}
            style={{ marginRight: "12px", opacity: isSyncing ? 0.6 : 1 }}
          >
            {isSyncing ? "Синхронизация..." : "Проверить новинки"}
          </button>
          <button className={styles.btnAdd} onClick={handleOpenCreate}>
            <Plus size={16} />
            Добавить автора
          </button>
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
          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} onClick={handleCloseModal}>
              Отмена
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={isSaving || !formData.name.trim()}>
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </form>
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
        onSuccess={loadAuthors}
      />
    </div>
  );
}
