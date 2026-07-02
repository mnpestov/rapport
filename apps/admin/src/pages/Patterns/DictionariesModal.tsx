import { useState, useRef } from "react";
import { Check, X, Pencil, Trash2, Search } from "lucide-react";
import { DictionaryItem, updateCategory, deleteCategory, updateTag, deleteTag } from "../../api/patterns";
import { Modal } from "../../components/Modal/Modal";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import toast from "react-hot-toast";
import styles from "./DictionariesModal.module.css";

type Tab = "categories" | "tags";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  categories: DictionaryItem[];
  tags: DictionaryItem[];
  onRefresh: () => void;
}

function pluralize(count: number): string {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "описаний";
  if (n1 > 1 && n1 < 5) return "описания";
  if (n1 === 1) return "описание";
  return "описаний";
}

export function DictionariesModal({ isOpen, onClose, categories, tags, onRefresh }: Props) {
  const [tab, setTab] = useState<Tab>("categories");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingItem, setDeletingItem] = useState<DictionaryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const allItems = tab === "categories" ? categories : tags;
  const items = search.trim()
    ? allItems.filter(i => i.name.toLowerCase().includes(search.trim().toLowerCase()))
    : allItems;

  const switchTab = (next: Tab) => {
    setTab(next);
    setSearch("");
    setEditingId(null);
    setEditingName("");
  };

  const startEdit = (item: DictionaryItem) => {
    setEditingId(item.id);
    setEditingName(item.name);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const saveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    if (editingName.trim() === items.find(i => i.id === editingId)?.name) {
      cancelEdit();
      return;
    }
    try {
      setSaving(true);
      if (tab === "categories") {
        await updateCategory(editingId, editingName.trim());
      } else {
        await updateTag(editingId, editingName.trim());
      }
      toast.success("Переименовано");
      onRefresh();
      cancelEdit();
    } catch {
      toast.error("Ошибка при сохранении");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") cancelEdit();
  };

  const confirmDelete = async () => {
    if (!deletingItem) return;
    try {
      setDeleting(true);
      if (tab === "categories") {
        await deleteCategory(deletingItem.id);
      } else {
        await deleteTag(deletingItem.id);
      }
      toast.success("Удалено");
      onRefresh();
      setDeletingItem(null);
    } catch {
      toast.error("Ошибка при удалении");
    } finally {
      setDeleting(false);
    }
  };

  const deleteMessage = deletingItem
    ? deletingItem.patternsCount > 0
      ? `«${deletingItem.name}» используется в ${deletingItem.patternsCount} ${pluralize(deletingItem.patternsCount)}. После удаления тег будет убран из всех описаний. Продолжить?`
      : `Удалить «${deletingItem.name}»?`
    : "";

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Справочники" maxWidth={520}>
        <div className={styles.tabs}>
          <button
            className={tab === "categories" ? styles.tabActive : styles.tab}
            onClick={() => switchTab("categories")}
          >
            Категории ({categories.length})
          </button>
          <button
            className={tab === "tags" ? styles.tabActive : styles.tab}
            onClick={() => switchTab("tags")}
          >
            Характеристики ({tags.length})
          </button>
        </div>

        <div className={styles.searchWrapper}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Поиск..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={styles.searchClear} onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          )}
        </div>

        <div className={styles.list}>
          {items.map(item => (
            <div key={item.id} className={styles.item}>
              {editingId === item.id ? (
                <>
                  <input
                    ref={inputRef}
                    className={styles.editInput}
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={saving}
                  />
                  <div className={styles.itemActions}>
                    <button className={styles.iconBtnGreen} onClick={saveEdit} disabled={saving} title="Сохранить">
                      <Check size={15} />
                    </button>
                    <button className={styles.iconBtnGray} onClick={cancelEdit} disabled={saving} title="Отмена">
                      <X size={15} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className={styles.itemName}>{item.name}</span>
                  <span className={styles.itemCount}>{item.patternsCount} {pluralize(item.patternsCount)}</span>
                  <div className={styles.itemActions}>
                    <button className={styles.iconBtnGray} onClick={() => startEdit(item)} title="Переименовать">
                      <Pencil size={14} />
                    </button>
                    <button className={styles.iconBtnRed} onClick={() => setDeletingItem(item)} title="Удалить">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <div className={styles.empty}>{search ? "Ничего не найдено" : "Нет элементов"}</div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deletingItem}
        title={deletingItem?.patternsCount ? "Удалить используемый элемент?" : "Удалить элемент"}
        message={deleteMessage}
        confirmText="Удалить"
        cancelText="Отмена"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeletingItem(null)}
      />
    </>
  );
}
