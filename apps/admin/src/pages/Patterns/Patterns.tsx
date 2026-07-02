import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus } from "lucide-react";
import { getPatterns, createPattern, deletePattern, resetAllIsNew, AdminPatternItem, getCategories, getTags, getInstruments, DictionaryItem, getPatternById, updatePatternById, fixArchiveQuotes } from "../../api/patterns";
import { getAuthors, AuthorItem } from "../../api/authors";
import { PatternCard, PatternCardHeader } from "./PatternCard";
import { Modal } from "../../components/Modal/Modal";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import CreatableSelect from "react-select/creatable";
import { ImageCropper } from "../../components/ImageCropper/ImageCropper";
import toast from "react-hot-toast";
import styles from "./Patterns.module.css";

export function Patterns() {
  const [data, setData] = useState<AdminPatternItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  
  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const observerTarget = useRef<HTMLDivElement>(null);
  
  // Local UI state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const [status, setStatus] = useState("active"); // active, archive, all

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [authors, setAuthors] = useState<AuthorItem[]>([]);
  const originalFormDataRef = useRef<typeof formData | null>(null);

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetNewConfirmOpen, setResetNewConfirmOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    authorName: "",
    url: "",
    imageUrl: "",
    isFree: false,
    isNew: false,
    categories: [] as string[],
    tags: [] as string[],
    instruments: [] as string[]
  });

  const [categoriesList, setCategoriesList] = useState<DictionaryItem[]>([]);
  const [tagsList, setTagsList] = useState<DictionaryItem[]>([]);
  const [instrumentsList, setInstrumentsList] = useState<DictionaryItem[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
    loadPatterns(1);
  }, [status, debouncedSearchQuery]);

  useEffect(() => {
    loadAuthors();
    loadDictionaries();
  }, []);

  const loadDictionaries = async () => {
    try {
      const [c, t, i] = await Promise.all([getCategories(), getTags(), getInstruments()]);
      setCategoriesList(c);
      setTagsList(t);
      setInstrumentsList(i);
    } catch (err) {
      console.error("Failed to load dictionaries", err);
    }
  };

  const loadAuthors = async () => {
    try {
      const res = await getAuthors();
      setAuthors(res);
    } catch (err) {
      console.error("Failed to load authors for select", err);
    }
  };

  const loadPatterns = async (currentPage: number = 1) => {
    try {
      if (currentPage === 1) {
        setIsLoading(true);
      } else {
        setIsFetchingMore(true);
      }
      setError(null);
      const res = await getPatterns(currentPage, 50, status, debouncedSearchQuery);
      if (currentPage === 1) {
        setData(res.items);
      } else {
        setData(prev => [...prev, ...res.items]);
      }
      setTotalPages(res.totalPages);
      if (currentPage === 1) setTotalCount(res.total);
    } catch (err: any) {
      setError(err.message || "Failed to load patterns");
    } finally {
      setIsLoading(false);
      setIsFetchingMore(false);
    }
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingMore && page < totalPages) {
          const nextPage = page + 1;
          setPage(nextPage);
          loadPatterns(nextPage);
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [isFetchingMore, page, totalPages, status, debouncedSearchQuery]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(data.map((item) => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    setSelectedIds(next);
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setFormData({
      title: "",
      authorName: "",
      url: "",
      imageUrl: "",
      isFree: false,
      isNew: false,
      categories: [],
      tags: [],
      instruments: []
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = async (id: string) => {
    try {
      const res = await getPatternById(id);
      const loaded = {
        title: res.title || "",
        authorName: res.author?.name || "",
        url: res.url || "",
        imageUrl: res.imageUrl || "",
        isFree: res.isFree || false,
        isNew: res.isNew || false,
        categories: (res.categories || []).map(c => c?.name || ""),
        tags: (res.tags || []).map(t => t?.name || ""),
        instruments: (res.instruments || []).map(i => i?.name || "")
      };
      setFormData(loaded);
      originalFormDataRef.current = { ...loaded, categories: [...loaded.categories], tags: [...loaded.tags], instruments: [...loaded.instruments] };
      setEditingId(id);
      setIsModalOpen(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to load pattern details");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.url || !formData.imageUrl || !formData.authorName) {
      toast.error("Пожалуйста, заполните все обязательные поля");
      return;
    }

    try {
      setIsSaving(true);
      if (editingId) {
        // Only send changed fields to avoid false duplicate errors
        const orig = originalFormDataRef.current;
        const payload: Record<string, any> = {};
        if (!orig || formData.title !== orig.title) payload.title = formData.title;
        if (!orig || formData.url !== orig.url) payload.url = formData.url;
        if (!orig || formData.imageUrl !== orig.imageUrl) payload.imageUrl = formData.imageUrl;
        if (!orig || formData.authorName !== orig.authorName) payload.authorName = formData.authorName;
        if (!orig || formData.isFree !== orig.isFree) payload.isFree = formData.isFree;
        if (!orig || formData.isNew !== orig.isNew) payload.isNew = formData.isNew;
        if (!orig || JSON.stringify(formData.categories) !== JSON.stringify(orig.categories)) payload.categories = formData.categories;
        if (!orig || JSON.stringify(formData.tags) !== JSON.stringify(orig.tags)) payload.tags = formData.tags;
        if (!orig || JSON.stringify(formData.instruments) !== JSON.stringify(orig.instruments)) payload.instruments = formData.instruments;

        await updatePatternById(editingId, payload);
        // Update the item locally instead of reloading the whole list
        setData(prev => prev.map(item => {
          if (item.id !== editingId) return item;
          return {
            ...item,
            title: formData.title,
            url: formData.url,
            author: formData.authorName,
            category: formData.categories.join(", "),
            instrument: formData.instruments.join(", "),
          };
        }));
        toast.success("Описание успешно обновлено");
      } else {
        await createPattern(formData);
        toast.success("Описание успешно создано");
        setPage(1);
        await loadPatterns(1);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to save pattern");
    } finally {
      setIsSaving(false);
      originalFormDataRef.current = null;
    }
  };

  const handleRestoreSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map(id => updatePatternById(id, { isVisible: true })));
      toast.success("Выбранные описания успешно восстановлены");
      setPage(1);
      await loadPatterns(1);
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error(err.message || "Failed to restore patterns");
    }
  };

  const confirmResetAllIsNew = async () => {
    setResetNewConfirmOpen(false);
    try {
      const { updated } = await resetAllIsNew();
      toast.success(`Флаг «Новинка» снят у ${updated} описаний`);
    } catch (err: any) {
      toast.error(err.message || "Не удалось сбросить флаг «Новинка»");
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setConfirmOpen(true);
  };

  const confirmDeleteSelected = async () => {
    setConfirmOpen(false);
    try {
      await Promise.all(Array.from(selectedIds).map(id => deletePattern(id)));
      setData(prev => prev.filter(item => !selectedIds.has(item.id)));
      setSelectedIds(new Set());
      if (status === "archive") {
        toast.success("Описания успешно удалены навсегда");
      } else {
        toast.success("Описания успешно скрыты");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete patterns");
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>Описания</h1>
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
        {totalCount !== null && (
          <div className={styles.totalCount}>
            <span className={styles.totalCountLabel}>Всего описаний: </span>
            <span className={styles.totalCountValue}>{totalCount}</span>
          </div>
        )}
      </div>

      <div className={styles.controlsPanel}>
        <div className={styles.leftControls}>
          <div className={styles.tabsContainer}>
            <button 
              className={status === "active" ? styles.tabActive : styles.tab} 
              onClick={() => setStatus("active")}
            >
              Активные
            </button>
            <button 
              className={status === "archive" ? styles.tabActive : styles.tab} 
              onClick={() => setStatus("archive")}
            >
              Архивные
            </button>
            <button 
              className={status === "all" ? styles.tabActive : styles.tab} 
              onClick={() => setStatus("all")}
            >
              Все
            </button>
          </div>
        </div>

        <div className={styles.rightControls}>
          <button className={styles.btnAdd} onClick={handleOpenCreate}>
            <Plus size={16} />
            Добавить описание
          </button>
          <button className={styles.btnResetNew} onClick={() => setResetNewConfirmOpen(true)}>
            Убрать статус «Новинка»
          </button>
          {status === "archive" && (
            <button
              className={styles.btnAdd}
              style={{ background: "#D8520F" }}
              disabled={selectedIds.size === 0}
              onClick={handleRestoreSelected}
            >
              Восстановить
            </button>
          )}
          {status === "archive" && (
            <button
              className={styles.btnResetNew}
              onClick={async () => {
                try {
                  const { updated } = await fixArchiveQuotes();
                  toast.success(updated > 0 ? `Кавычки заменены в ${updated} описаниях` : "Описаний с кавычками не найдено");
                  if (updated > 0) setPage(1);
                } catch {
                  toast.error("Не удалось заменить кавычки");
                }
              }}
            >
              Заменить кавычки
            </button>
          )}
          <button 
            className={styles.btnDelete} 
            disabled={selectedIds.size === 0}
            onClick={handleDeleteSelected}
          >
            Удалить
          </button>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <PatternCardHeader
          allSelected={data.length > 0 && selectedIds.size === data.length}
          onSelectAll={handleSelectAll}
        />

        {isLoading && (
          <div className={styles.centerState}>Загрузка...</div>
        )}

        {!isLoading && error && (
          <div className={styles.centerState} style={{ color: "#ef4444" }}>{error}</div>
        )}

        {!isLoading && !error && data.length === 0 && (
          <div className={styles.centerState}>Описаний пока нет</div>
        )}

        {!isLoading && !error && data.map((item) => (
          <PatternCard
            key={item.id}
            item={item}
            isSelected={selectedIds.has(item.id)}
            onSelect={handleSelectRow}
            onEdit={handleOpenEdit}
          />
        ))}

        {page < totalPages && (
          <div ref={observerTarget} style={{ padding: 20, textAlign: "center", color: "#6b7280" }}>
            Загрузка...
          </div>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? "Редактировать описание" : "Добавить новое описание"} maxWidth={760}>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "grid", gridTemplateColumns: "330px 330px", columnGap: 20, rowGap: 30 }}>
            {/* Left */}
            <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontFamily: "Mulish", fontSize: 15, fontWeight: 400, color: "#1D1C1C" }}>Название <span style={{ color: "#ef4444" }}>*</span></label>
                <input 
                  type="text" 
                  value={formData.title} 
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  style={{ width: 330, height: 45, padding: "13px 15px", background: "#F3F3F3", border: "none", borderRadius: 2, fontFamily: "Mulish", fontSize: 15, color: "#1D1C1C", boxSizing: "border-box" }}
                  placeholder="Название"
                  required
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, height: 45 }}>
                <input
                  type="checkbox"
                  id="isNew"
                  checked={formData.isNew}
                  onChange={e => setFormData({ ...formData, isNew: e.target.checked })}
                  style={{ width: 18, height: 18, accentColor: "#9B9A9A" }}
                />
                <label htmlFor="isNew" style={{ fontFamily: "Mulish", fontSize: 15, color: "#1D1C1C", cursor: "pointer" }}>Новинка</label>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontFamily: "Mulish", fontSize: 15, fontWeight: 400, color: "#1D1C1C" }}>Характеристики <span style={{ color: "#9B9A9A", fontSize: 13 }}>(необязательно)</span></label>
                <CreatableSelect
                  isMulti
                  styles={{
                    control: (base: any) => ({ ...base, width: 330, minHeight: 45, background: "#F3F3F3", border: "none", borderRadius: 2, boxShadow: "none", fontFamily: "Mulish", fontSize: 15, cursor: "pointer" }),
                    valueContainer: (base: any) => ({ ...base, padding: "0 15px" }),
                    placeholder: (base: any) => ({ ...base, color: "#9B9A9A" }),
                    menu: (base: any) => ({ ...base, fontFamily: "Mulish", fontSize: 15 })
                  }}
                  options={tagsList.map(t => ({ value: t.name, label: t.name }))}
                  value={formData.tags.map(t => ({ value: t, label: t }))}
                  onChange={(vals) => setFormData({ ...formData, tags: vals.map(v => v.value) })}
                  placeholder="Характеристики"
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontFamily: "Mulish", fontSize: 15, fontWeight: 400, color: "#1D1C1C" }}>Ссылка <span style={{ color: "#ef4444" }}>*</span></label>
                <input 
                  type="url" 
                  value={formData.url} 
                  onChange={e => setFormData({ ...formData, url: e.target.value })}
                  style={{ width: 330, height: 45, padding: "13px 15px", background: "#F3F3F3", border: "none", borderRadius: 2, fontFamily: "Mulish", fontSize: 15, color: "#1D1C1C", boxSizing: "border-box" }}
                  placeholder="Вставить ссылку"
                  required
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={{ fontFamily: "Mulish", fontSize: 15, fontWeight: 400, color: "#1D1C1C", display: "none" }}>Фото <span style={{ color: "#ef4444" }}>*</span></label>
                </div>
                <ImageCropper 
                  onImageUploaded={(url) => setFormData({ ...formData, imageUrl: url })} 
                  currentUrl={formData.imageUrl} 
                  customButtonText={formData.imageUrl ? (editingId ? "Изменить фото" : "Фото загружено") : "Загрузить фото *"}
                  customButtonProps={{ style: { width: 330, height: 45, padding: "8.5px 15px", background: formData.imageUrl ? "#83942C" : "#9B9A9A", borderRadius: 4, color: "#FFF", fontFamily: "Mulish", fontSize: 15, border: "none", cursor: "pointer", display: "flex", alignItems: "center", boxSizing: "border-box", justifyContent: "flex-start" } }}
                />
              </div>
            </div>

            {/* Right */}
            <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontFamily: "Mulish", fontSize: 15, fontWeight: 400, color: "#1D1C1C" }}>Категория <span style={{ color: "#9B9A9A", fontSize: 13 }}>(необязательно)</span></label>
                <CreatableSelect
                  isMulti
                  styles={{
                    control: (base: any) => ({ ...base, width: 330, minHeight: 45, background: "#F3F3F3", border: "none", borderRadius: 2, boxShadow: "none", fontFamily: "Mulish", fontSize: 15, cursor: "pointer" }),
                    valueContainer: (base: any) => ({ ...base, padding: "0 15px" }),
                    placeholder: (base: any) => ({ ...base, color: "#9B9A9A" }),
                    menu: (base: any) => ({ ...base, fontFamily: "Mulish", fontSize: 15 })
                  }}
                  options={categoriesList.map(c => ({ value: c.name, label: c.name }))}
                  value={formData.categories.map(c => ({ value: c, label: c }))}
                  onChange={(vals) => setFormData({ ...formData, categories: vals.map(v => v.value) })}
                  placeholder="Категории"
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, height: 45 }}>
                <input
                  type="checkbox"
                  id="isFree"
                  checked={formData.isFree}
                  onChange={e => setFormData({ ...formData, isFree: e.target.checked })}
                  style={{ width: 18, height: 18, accentColor: "#9B9A9A" }}
                />
                <label htmlFor="isFree" style={{ fontFamily: "Mulish", fontSize: 15, color: "#1D1C1C", cursor: "pointer" }}>Бесплатное</label>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontFamily: "Mulish", fontSize: 15, fontWeight: 400, color: "#1D1C1C" }}>Автор <span style={{ color: "#ef4444" }}>*</span></label>
                <CreatableSelect
                  isClearable
                  styles={{
                    control: (base: any) => ({ ...base, width: 330, minHeight: 45, background: "#F3F3F3", border: "none", borderRadius: 2, boxShadow: "none", fontFamily: "Mulish", fontSize: 15, cursor: "pointer" }),
                    valueContainer: (base: any) => ({ ...base, padding: "0 15px" }),
                    placeholder: (base: any) => ({ ...base, color: "#9B9A9A" }),
                    menu: (base: any) => ({ ...base, fontFamily: "Mulish", fontSize: 15 })
                  }}
                  options={authors.map(a => ({ value: a.name, label: a.name }))}
                  value={formData.authorName ? { value: formData.authorName, label: formData.authorName } : null}
                  onChange={(val) => setFormData({ ...formData, authorName: val?.value || "" })}
                  placeholder="Автор"
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontFamily: "Mulish", fontSize: 15, fontWeight: 400, color: "#1D1C1C" }}>Инструмент <span style={{ color: "#9B9A9A", fontSize: 13 }}>(необязательно)</span></label>
                <CreatableSelect
                  isMulti
                  styles={{
                    control: (base: any) => ({ ...base, width: 330, minHeight: 45, background: "#F3F3F3", border: "none", borderRadius: 2, boxShadow: "none", fontFamily: "Mulish", fontSize: 15, cursor: "pointer" }),
                    valueContainer: (base: any) => ({ ...base, padding: "0 15px" }),
                    placeholder: (base: any) => ({ ...base, color: "#9B9A9A" }),
                    menu: (base: any) => ({ ...base, fontFamily: "Mulish", fontSize: 15 })
                  }}
                  options={instrumentsList.map(i => ({ value: i.name, label: i.name }))}
                  value={formData.instruments.map(i => ({ value: i, label: i }))}
                  onChange={(vals) => setFormData({ ...formData, instruments: vals.map(v => v.value) })}
                  placeholder="Инструмент"
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 40 }}>
            <button 
              type="button" 
              onClick={() => setIsModalOpen(false)}
              style={{ width: 100, height: 32, display: "flex", justifyContent: "center", alignItems: "center", background: "transparent", color: "#83942C", border: "1px solid #BEC1F4", borderRadius: 4, fontFamily: 'Mulish', fontSize: 12.64, cursor: "pointer" }}
            >
              Закрыть
            </button>
            <button 
              type="submit" 
              disabled={isSaving}
              style={{ width: 100, height: 32, display: "flex", justifyContent: "center", alignItems: "center", background: "#83942C", color: "#FFF", border: "none", borderRadius: 4, fontFamily: 'Mulish', fontSize: 12.64, cursor: "pointer" }}
            >
              {isSaving ? "Сохранение" : "Сохранить"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmOpen}
        title={status === "archive" ? "Удалить навсегда" : "Скрыть описания"}
        message={status === "archive" 
          ? `Вы уверены, что хотите удалить выбранные карточки (${selectedIds.size} шт.) навсегда? Это действие необратимо, картинка также будет удалена.` 
          : `Вы уверены, что хотите скрыть выбранные описания (${selectedIds.size} шт.)? Они переместятся в архив.`}
        confirmText={status === "archive" ? "Удалить" : "Скрыть"}
        cancelText="Отмена"
        variant="danger"
        onConfirm={confirmDeleteSelected}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        isOpen={resetNewConfirmOpen}
        title="Сбросить все новинки"
        message="Флаг «Новинка» будет снят у всех описаний. Продолжить?"
        confirmText="Сбросить"
        cancelText="Отмена"
        variant="danger"
        onConfirm={confirmResetAllIsNew}
        onCancel={() => setResetNewConfirmOpen(false)}
      />
    </div>
  );
}
