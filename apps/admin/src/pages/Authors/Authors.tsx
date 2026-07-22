import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { AuthorRow, AuthorRowHeader } from "./AuthorRow";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { getAuthors, createAuthor, updateAuthor, deleteAuthor, AuthorItem } from "../../api/authors";
import { Modal } from "../../components/Modal/Modal";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import toast from "react-hot-toast";
import styles from "./Authors.module.css";

export function Authors() {
  const [authors, setAuthors] = useState<AuthorItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAuthor, setEditingAuthor] = useState<AuthorItem | null>(null);
  const [formData, setFormData] = useState({ name: "", site: "" });
  const [isSaving, setIsSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [authorToDelete, setAuthorToDelete] = useState<AuthorItem | null>(null);

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
      const data = await getAuthors(debouncedSearchQuery);
      setAuthors(data);
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
          <button className={styles.btnAdd} onClick={handleOpenCreate}>
            <Plus size={16} />
            Добавить автора
          </button>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <AuthorRowHeader />
        {authors.map((author) => (
          <AuthorRow
            key={author.id}
            author={author}
            onEdit={handleOpenEdit}
            onDelete={handleDelete}
          />
        ))}
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
    </div>
  );
}
