import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Search, Trash2, Plus, Merge } from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import {
  YarnItem,
  getYarns,
  createYarn,
  updateYarn,
  deleteYarn,
  mergeYarn,
} from "../../api/yarns";
import { YarnEditModal } from "./YarnEditModal";
import { YarnMergeModal } from "./YarnMergeModal";
import styles from "./Yarns.module.css";

/**
 * Справочник артикулов пряжи. В отличие от Dictionaries — 2778 строк, поэтому
 * поиск и страницы серверные: грузить всё разом, как категории, здесь нельзя.
 *
 * Фильтр «без метража» не украшение: метраж — единственная характеристика,
 * по которой видно, что артикул привязан к правильной линейке, и карточки
 * без него нужно пополнять в первую очередь.
 */
export function Yarns() {
  const [items, setItems] = useState<YarnItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [noMetrage, setNoMetrage] = useState(false);
  const [genericOnly, setGenericOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<YarnItem | "new" | null>(null);
  const [merging, setMerging] = useState<YarnItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<YarnItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Смена фильтра со второй страницы оставила бы пустой список: под новый
  // фильтр столько строк может просто не набраться.
  useEffect(() => setPage(1), [debounced, noMetrage, genericOnly]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getYarns({ q: debounced, page, noMetrage, generic: genericOnly });
      setItems(res.items);
      setTotal(res.total);
      setPageSize(res.pageSize);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить справочник");
    } finally {
      setLoading(false);
    }
  }, [debounced, page, noMetrage, genericOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (data: Partial<YarnItem>) => {
    try {
      if (editing === "new") {
        await createYarn(data);
        toast.success("Артикул создан");
      } else if (editing) {
        await updateYarn(editing.id, data);
        toast.success("Сохранено");
      }
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    setDeleting(true);
    try {
      await deleteYarn(deletingItem.id);
      toast.success("Артикул удалён");
      setDeletingItem(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  };

  const handleMerge = async (targetId: string) => {
    if (!merging) return;
    try {
      await mergeYarn(merging.id, targetId);
      toast.success("Карточки слиты");
      setMerging(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось слить");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.page}>
      <PageHeader title="Артикулы пряжи" />

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Название, бренд или написание автора"
          />
        </div>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={noMetrage} onChange={(e) => setNoMetrage(e.target.checked)} />
          Без метража
        </label>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={genericOnly} onChange={(e) => setGenericOnly(e.target.checked)} />
          Родовые
        </label>
        <button type="button" className={styles.addBtn} onClick={() => setEditing("new")}>
          <Plus size={15} /> Добавить
        </button>
      </div>

      <div className={styles.count}>
        {loading ? <Loader2 size={13} className={styles.spinner} /> : null}
        Найдено: {total}
      </div>

      <div className={styles.table}>
        <div className={styles.headRow}>
          <span>Название</span>
          <span>Метраж</span>
          <span>Состав</span>
          <span>Спицы</span>
          <span>Описаний</span>
          <span />
        </div>
        {items.map((y) => (
          <div key={y.id} className={styles.row}>
            <span className={styles.nameCell}>
              <span className={styles.name}>{y.name}</span>
              {y.isGeneric && <span className={styles.badge}>родовой</span>}
              {y.aliases.length > 0 && (
                <span className={styles.aliases} title={y.aliases.map((a) => a.alias).join("\n")}>
                  +{y.aliases.length} написан.
                </span>
              )}
            </span>
            <span className={y.mPer100g == null ? styles.missing : undefined}>
              {y.mPer100g != null ? `${y.mPer100g} м/100 г` : "—"}
            </span>
            <span className={styles.clip} title={y.composition || ""}>{y.composition || "—"}</span>
            <span>{y.needleSizeRaw || "—"}</span>
            <span>{y._count.patterns || "—"}</span>
            <span className={styles.actions}>
              <button type="button" onClick={() => setEditing(y)} title="Редактировать">
                <Pencil size={15} />
              </button>
              <button type="button" onClick={() => setMerging(y)} title="Слить с другим артикулом">
                <Merge size={15} />
              </button>
              <button type="button" onClick={() => setDeletingItem(y)} title="Удалить">
                <Trash2 size={15} />
              </button>
            </span>
          </div>
        ))}
        {!loading && items.length === 0 && <div className={styles.empty}>Ничего не найдено</div>}
      </div>

      {totalPages > 1 && (
        <div className={styles.pager}>
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </button>
          <span>
            {page} из {totalPages}
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Вперёд
          </button>
        </div>
      )}

      {editing && (
        <YarnEditModal
          yarn={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      {merging && (
        <YarnMergeModal source={merging} onClose={() => setMerging(null)} onMerge={handleMerge} />
      )}
      <ConfirmDialog
        isOpen={!!deletingItem}
        title="Удалить артикул?"
        message={
          deletingItem
            ? `«${deletingItem.name}» будет удалён из справочника. Если он связан с описаниями, удаление не пройдёт — такие карточки нужно сливать, а не удалять.`
            : ""
        }
        confirmText={deleting ? "Удаляем…" : "Удалить"}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeletingItem(null)}
      />
    </div>
  );
}
