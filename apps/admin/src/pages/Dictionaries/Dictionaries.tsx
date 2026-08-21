import { useEffect, useState, useRef } from "react";
import { Check, X, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import {
  DictionaryItem,
  getCategories,
  getTags,
  getInstruments,
  updateCategory,
  deleteCategory,
  updateTag,
  deleteTag,
  updateInstrument,
  deleteInstrument,
} from "../../api/patterns";
import styles from "./Dictionaries.module.css";

// Полноценная страница справочников. Раньше то же самое (без инструментов)
// было доступно только модалкой со страницы описаний — DictionariesModal.tsx.
// Модалка оставлена как есть: она открывается прямо из формы описания, где
// уходить со страницы ради переименования тега неудобно.
type Tab = "categories" | "tags" | "instruments";

const TABS: { key: Tab; label: string }[] = [
  { key: "categories", label: "Категории" },
  { key: "tags", label: "Характеристики" },
  { key: "instruments", label: "Инструменты" },
];

// Операции различаются только эндпоинтом, поэтому вкладка выбирает пару
// функций, а не разветвляет обработчики.
const API: Record<Tab, {
  load: () => Promise<DictionaryItem[]>;
  update: (id: string, name: string) => Promise<DictionaryItem>;
  remove: (id: string) => Promise<void>;
}> = {
  categories: { load: getCategories, update: updateCategory, remove: deleteCategory },
  tags: { load: getTags, update: updateTag, remove: deleteTag },
  instruments: { load: getInstruments, update: updateInstrument, remove: deleteInstrument },
};

function pluralize(count: number): string {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "описаний";
  if (n1 > 1 && n1 < 5) return "описания";
  if (n1 === 1) return "описание";
  return "описаний";
}

export function Dictionaries() {
  const [tab, setTab] = useState<Tab>("categories");
  const [items, setItems] = useState<Record<Tab, DictionaryItem[]>>({
    categories: [],
    tags: [],
    instruments: [],
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingItem, setDeletingItem] = useState<DictionaryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Все три справочника грузятся разом: они небольшие, а счётчики во
  // вкладках должны быть видны сразу, не только у открытой вкладки.
  const loadAll = async () => {
    try {
      setLoading(true);
      const [categories, tags, instruments] = await Promise.all([
        getCategories(),
        getTags(),
        getInstruments(),
      ]);
      setItems({ categories, tags, instruments });
    } catch {
      toast.error("Не удалось загрузить справочники");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Перезагружаем только затронутый справочник: правка тега не меняет
  // категории, а лишние два запроса тут ничего не дают.
  const refreshCurrent = async () => {
    try {
      const fresh = await API[tab].load();
      setItems(prev => ({ ...prev, [tab]: fresh }));
    } catch {
      toast.error("Не удалось обновить список");
    }
  };

  const allItems = items[tab];
  const visibleItems = search.trim()
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
    if (editingName.trim() === allItems.find(i => i.id === editingId)?.name) {
      cancelEdit();
      return;
    }
    try {
      setSaving(true);
      await API[tab].update(editingId, editingName.trim());
      toast.success("Переименовано");
      await refreshCurrent();
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
      await API[tab].remove(deletingItem.id);
      toast.success("Удалено");
      await refreshCurrent();
      setDeletingItem(null);
    } catch {
      toast.error("Ошибка при удалении");
    } finally {
      setDeleting(false);
    }
  };

  const deleteMessage = deletingItem
    ? deletingItem.patternsCount > 0
      ? `«${deletingItem.name}» используется в ${deletingItem.patternsCount} ${pluralize(deletingItem.patternsCount)}. После удаления значение будет убрано из всех описаний. Продолжить?`
      : `Удалить «${deletingItem.name}»?`
    : "";

  return (
    <div className={styles.page}>
      <PageHeader
        title="Справочники"
        totalCount={{ label: "значений", value: allItems.length }}
      />

      <div className={styles.tabs}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            className={tab === key ? styles.tabActive : styles.tab}
            onClick={() => switchTab(key)}
          >
            {label} ({items[key].length})
          </button>
        ))}
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

      {loading ? (
        <div className={styles.empty}>
          <Loader2 size={16} className={styles.spinner} /> Загрузка...
        </div>
      ) : (
        <div className={styles.list}>
          {visibleItems.map(item => (
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
                  <span className={styles.itemCount}>
                    {item.patternsCount} {pluralize(item.patternsCount)}
                  </span>
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
          {visibleItems.length === 0 && (
            <div className={styles.empty}>{search ? "Ничего не найдено" : "Нет элементов"}</div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deletingItem}
        title={deletingItem?.patternsCount ? "Удалить используемое значение?" : "Удалить значение"}
        message={deleteMessage}
        confirmText="Удалить"
        cancelText="Отмена"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeletingItem(null)}
      />
    </div>
  );
}
