import { useCallback, useEffect, useState } from "react";
import { SquarePen, Trash2, Plus, Merge, Check, X } from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Button, IconButton } from "../../components/Button/Button";
import { ControlPanel } from "../../components/ControlPanel/ControlPanel";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import {
  YarnItem,
  YarnUpdatePayload,
  getYarns,
  createYarn,
  updateYarn,
  deleteYarn,
  mergeYarn,
  approveYarn,
  rejectPendingYarn,
  YarnFieldSuggestionItem,
  getYarnFieldSuggestions,
  approveYarnFieldSuggestion,
  rejectYarnFieldSuggestion,
} from "../../api/yarns";
import { YarnEditModal } from "./YarnEditModal";
import { YarnMergeModal } from "./YarnMergeModal";
import styles from "./Yarns.module.css";

type TabValue = "catalog" | "pending" | "field-suggestions";

/**
 * Справочник артикулов пряжи. В отличие от Dictionaries — 2778 строк, поэтому
 * поиск и страницы серверные: грузить всё разом, как категории, здесь нельзя.
 *
 * Фильтр «без метража» не украшение: метраж — единственная характеристика,
 * по которой видно, что артикул привязан к правильной линейке, и карточки
 * без него нужно пополнять в первую очередь.
 *
 * Вкладка «На проверке» — очередь модерации артикулов, созданных авторами
 * через POST /author/yarns (implementation_plan_moderation_yarns_articles.md).
 * Не в общем справочнике: PENDING-артикулы не должны попадаться при обычном
 * поиске/пролистывании, только в этой явно отдельной очереди.
 */
export function Yarns() {
  const [tab, setTab] = useState<TabValue>("catalog");

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

  // Очередь «На проверке» — отдельный список, отдельная загрузка. Не общий
  // getYarns(search=...) с фильтром на клиенте: очередь должна показывать
  // все PENDING разом, без пагинации — их число невелико по определению
  // (модератор разбирает быстро, не копится тысячами).
  const [pendingItems, setPendingItems] = useState<YarnItem[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  // Client-side, не новый запрос — очередь и так грузится целиком (см.
  // комментарий выше про отсутствие пагинации у pending).
  const [stashOnly, setStashOnly] = useState(false);
  const [rejectingItem, setRejectingItem] = useState<YarnItem | null>(null);
  const [rejecting, setRejecting] = useState(false);

  // Заявки на дозаполнение метража/состава уже существующих (APPROVED)
  // артикулов — предложены владельцами личного хранилища пряжи. Отдельная
  // очередь от pendingItems выше: та про новые артикулы, эта про дельту к
  // живым записям справочника.
  const [fieldSuggestions, setFieldSuggestions] = useState<YarnFieldSuggestionItem[]>([]);
  const [fieldSuggestionsLoading, setFieldSuggestionsLoading] = useState(true);

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

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await getYarns({ pending: true });
      setPendingItems(res.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить очередь");
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const loadFieldSuggestions = useCallback(async () => {
    setFieldSuggestionsLoading(true);
    try {
      const res = await getYarnFieldSuggestions();
      setFieldSuggestions(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить заявки");
    } finally {
      setFieldSuggestionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFieldSuggestions();
  }, [loadFieldSuggestions]);

  const handleApproveFieldSuggestion = async (item: YarnFieldSuggestionItem) => {
    try {
      await approveYarnFieldSuggestion(item.id);
      toast.success(`Данные «${item.yarn.name}» дозаполнены`);
      loadFieldSuggestions();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось одобрить");
    }
  };

  const handleRejectFieldSuggestion = async (item: YarnFieldSuggestionItem) => {
    try {
      await rejectYarnFieldSuggestion(item.id);
      toast.success("Заявка отклонена");
      loadFieldSuggestions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отклонить");
    }
  };

  const handleSave = async (data: YarnUpdatePayload) => {
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
      // Артикул на модерации мог редактироваться прямо из очереди —
      // обновляем оба списка, дешевле чем угадывать откуда открыли модалку.
      loadPending();
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
      loadPending();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось слить");
    }
  };

  const handleApprove = async (item: YarnItem) => {
    try {
      await approveYarn(item.id);
      toast.success(`«${item.name}» одобрен`);
      loadPending();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось одобрить");
    }
  };

  const handleReject = async () => {
    if (!rejectingItem) return;
    setRejecting(true);
    try {
      await rejectPendingYarn(rejectingItem.id);
      toast.success("Артикул отклонён");
      setRejectingItem(null);
      loadPending();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отклонить");
    } finally {
      setRejecting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.page}>
      <PageHeader
        title="Артикулы пряжи"
        search={
          tab === "catalog"
            ? { value: search, onChange: setSearch, placeholder: "Название, бренд или написание автора" }
            : undefined
        }
        totalCount={
          tab === "catalog"
            ? { label: "артикулов", value: loading ? null : total }
            : undefined
        }
      />

      <ControlPanel
        tabs={[
          { value: "catalog", label: "Справочник" },
          { value: "pending", label: "На проверке", count: pendingItems.length || undefined },
          { value: "field-suggestions", label: "Заявки на дозаполнение", count: fieldSuggestions.length || undefined },
        ]}
        activeTab={tab}
        onTabChange={(v) => setTab(v as TabValue)}
        actions={
          tab === "catalog" ? (
            <>
              <label className={styles.checkbox}>
                <input type="checkbox" checked={noMetrage} onChange={(e) => setNoMetrage(e.target.checked)} />
                Без метража
              </label>
              <label className={styles.checkbox}>
                <input type="checkbox" checked={genericOnly} onChange={(e) => setGenericOnly(e.target.checked)} />
                Родовые
              </label>
              <Button icon={<Plus size={15} />} onClick={() => setEditing("new")}>
                Добавить
              </Button>
            </>
          ) : tab === "pending" ? (
            <label className={styles.checkbox}>
              <input type="checkbox" checked={stashOnly} onChange={(e) => setStashOnly(e.target.checked)} />
              Только из хранилища
            </label>
          ) : undefined
        }
      />

      {tab === "catalog" ? (
        <>
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
                  <IconButton onClick={() => setEditing(y)} title="Редактировать">
                    <SquarePen size={16} />
                  </IconButton>
                  <IconButton onClick={() => setMerging(y)} title="Слить с другим артикулом">
                    <Merge size={16} />
                  </IconButton>
                  <IconButton
                    onClick={() => setDeletingItem(y)}
                    title="Удалить"
                    style={{ color: "var(--danger)" }}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </span>
              </div>
            ))}
            {!loading && items.length === 0 && <div className={styles.empty}>Ничего не найдено</div>}
          </div>

          {totalPages > 1 && (
            <div className={styles.pager}>
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <span>
                {page} из {totalPages}
              </span>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Вперёд
              </Button>
            </div>
          )}
        </>
      ) : tab === "pending" ? (
        <div className={styles.table}>
          <div className={styles.headRow}>
            <span>Название</span>
            <span>Метраж</span>
            <span>Состав</span>
            <span>Описаний</span>
            <span />
          </div>
          {pendingItems
            .filter((y) => !stashOnly || y.createdVia === "STASH_USER")
            .map((y) => (
            <div key={y.id} className={styles.row}>
              <span className={styles.nameCell}>
                <span className={styles.name}>{y.name}</span>
                {y.isGeneric && <span className={styles.badge}>родовой</span>}
                {/* Источник заявки — AUTHOR (узкий проверенный круг) или
                    STASH_USER (личное хранилище пряжи, потенциально массовый
                    источник опечаток/дублей). Показываем бейдж только для
                    STASH_USER: AUTHOR — текущее большинство/дефолт, не
                    нуждается в подсветке (YARN_STASH_PLAN.md §5.4). */}
                {y.createdVia === "STASH_USER" && (
                  <span className={styles.badge} title="Заявка подана через личное хранилище пряжи пользователя">
                    из хранилища
                  </span>
                )}
                {y.createdVia === "SCRAPER_RAVELRY" && (
                  <span className={styles.badge} title="Автоматически найдена в Ravelry по точному совпадению для нераспознанного артикула из новинки">
                    из Ravelry
                  </span>
                )}
              </span>
              <span className={y.mPer100g == null ? styles.missing : undefined}>
                {y.mPer100g != null ? `${y.mPer100g} м/100 г` : "—"}
              </span>
              <span className={styles.clip} title={y.composition || ""}>{y.composition || "—"}</span>
              {/* _count.patterns может быть 0 даже для только что созданного
                  автором артикула — связь появляется при следующем
                  сохранении формы паттерна, не в момент создания (plan §1).
                  Не ошибка, ожидаемое состояние. */}
              <span>{y._count.patterns || "—"}</span>
              <span className={styles.actions}>
                <IconButton onClick={() => handleApprove(y)} title="Одобрить" style={{ color: "var(--brand)" }}>
                  <Check size={16} />
                </IconButton>
                <IconButton onClick={() => setEditing(y)} title="Редактировать">
                  <SquarePen size={16} />
                </IconButton>
                <IconButton onClick={() => setMerging(y)} title="Слить с существующим">
                  <Merge size={16} />
                </IconButton>
                <IconButton
                  onClick={() => setRejectingItem(y)}
                  title="Отклонить"
                  style={{ color: "var(--danger)" }}
                >
                  <X size={16} />
                </IconButton>
              </span>
            </div>
          ))}
          {!pendingLoading && pendingItems.filter((y) => !stashOnly || y.createdVia === "STASH_USER").length === 0 && (
            <div className={styles.empty}>
              {stashOnly ? "Нет заявок из хранилища пряжи" : "Нет артикулов на проверке"}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.headRow}>
            <span>Артикул</span>
            <span>Предложенный метраж</span>
            <span>Предложенный состав</span>
            <span>Кто предложил</span>
            <span />
          </div>
          {fieldSuggestions.map((s) => (
            <div key={s.id} className={styles.row}>
              <span className={styles.nameCell}>
                <span className={styles.name}>{s.yarn.name}</span>
                {s.yarn.brand && <span className={styles.clip}>{s.yarn.brand}</span>}
              </span>
              <span className={s.mPer100g == null ? styles.missing : undefined}>
                {s.mPer100g != null ? `${s.mPer100g} м/100 г` : "—"}
              </span>
              <span className={styles.clip} title={s.composition || ""}>{s.composition || "—"}</span>
              <span className={styles.clip}>
                {s.suggestedBy.username ? `@${s.suggestedBy.username}` : `${s.suggestedBy.firstName} ${s.suggestedBy.lastName || ""}`.trim()}
              </span>
              <span className={styles.actions}>
                <IconButton onClick={() => handleApproveFieldSuggestion(s)} title="Одобрить" style={{ color: "var(--brand)" }}>
                  <Check size={16} />
                </IconButton>
                <IconButton
                  onClick={() => handleRejectFieldSuggestion(s)}
                  title="Отклонить"
                  style={{ color: "var(--danger)" }}
                >
                  <X size={16} />
                </IconButton>
              </span>
            </div>
          ))}
          {!fieldSuggestionsLoading && fieldSuggestions.length === 0 && (
            <div className={styles.empty}>Нет заявок на дозаполнение</div>
          )}
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
      <ConfirmDialog
        isOpen={!!rejectingItem}
        title="Отклонить артикул?"
        message={
          rejectingItem
            ? rejectingItem.createdVia === "STASH_USER"
              // rejectPendingYarn не удаляет строку — ставит status: REJECTED,
              // isActive: false (YARN_STASH_PLAN.md §5.1). Владелец продолжает
              // видеть свой моток пряжи в хранилище как ни в чём не бывало,
              // просто карточка больше не попадает другим пользователям в
              // подсказки/поиск справочника.
              ? `«${rejectingItem.name}» перестанет предлагаться другим пользователям в поиске справочника. Пользователь, добавивший этот артикул в личное хранилище пряжи, не заметит отклонения — его моток останется у него как есть. Если артикул похож на существующий — используйте «Слить с существующим» вместо отклонения.`
              : `«${rejectingItem.name}» будет снят со всех связей с описаниями и перестанет предлагаться в поиске справочника. Автор увидит, что пряжа исчезла из его описания. Если артикул похож на существующий — используйте «Слить с существующим» вместо отклонения.`
            : ""
        }
        confirmText={rejecting ? "Отклоняем…" : "Отклонить"}
        variant="danger"
        onConfirm={handleReject}
        onCancel={() => setRejectingItem(null)}
      />
    </div>
  );
}
