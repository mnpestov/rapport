import { useEffect, useState } from "react";
import { Plus, Trash2, SquarePen, Search } from "lucide-react";
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
  const [formData, setFormData] = useState({ name: "" });
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
    setFormData({ name: "" });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (author: AuthorItem) => {
    setEditingAuthor(author);
    setFormData({ name: author.name });
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
        await updateAuthor(editingAuthor.id, formData.name);
      } else {
        await createAuthor(formData.name);
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
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>Авторы</h1>
        <div className={styles.searchWrapper}>
          <input 
            type="text" 
            placeholder="Поиск" 
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search size={18} color="#9ca3af" />
        </div>
      </div>

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
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Описаний</th>
              <th style={{ width: 100 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {authors.map((author) => (
              <tr key={author.id}>
                <td className={styles.tdText}>{author.name}</td>
                <td className={styles.tdText}>{author.patternsCount}</td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button 
                      className={styles.iconBtn} 
                      title="Редактировать"
                      onClick={() => handleOpenEdit(author)}
                    >
                      <SquarePen size={16} />
                    </button>
                    <button 
                      className={styles.iconBtn} 
                      title="Удалить"
                      onClick={() => handleDelete(author)}
                      disabled={author.patternsCount > 0}
                      style={{ color: author.patternsCount > 0 ? "#9ca3af" : "#ef4444" }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {authors.length === 0 && !isLoading && (
              <tr>
                <td colSpan={3} className={styles.centerState}>
                  Авторов пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
