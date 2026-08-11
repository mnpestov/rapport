import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X, Shield, Pen, ShieldX, Check } from "lucide-react";
import { ModerationCard } from "./ModerationCard";
import { PatternGridCard } from "./PatternGridCard";
import { ControlPanel, ControlPanelBtn, ViewToggle, ViewMode } from "../../components/ControlPanel/ControlPanel";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { getPatterns, createPattern, deletePattern, resetAllIsNew, AdminPatternItem, getCategories, getTags, getInstruments, getYarnRanges, DictionaryItem, YarnRange, getPatternById, updatePatternById, fixArchiveQuotes } from "../../api/patterns";
import { getAuthors, AuthorItem } from "../../api/authors";
import { PatternCard, PatternCardHeader, PatternStatus } from "./PatternCard";
import { Modal } from "../../components/Modal/Modal";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import { getAdminDrafts, approveDraft, rejectDraft, AdminDraft } from "../../api/admin-drafts";
import {
  CabinetDraft,
  CabinetPattern,
  CabinetItem,
  getCabinetItems,
  getCabinetAuthor,
  createCabinetDraft,
  updateCabinetDraft,
  submitCabinetDraft,
  createEditDraft,
  deleteCabinetDraft,
  archiveCabinetPattern,
} from "../../api/cabinet";
import CreatableSelect from "react-select/creatable";
import { ImageGalleryManager } from "../../components/ImageGalleryManager/ImageGalleryManager";
import toast from "react-hot-toast";
import styles from "./Patterns.module.css";
import { MAX_CATEGORIES, MAX_TAGS, labelStyle, optionalStyle, inputStyle, selectStyles, btnStyle, ModalCheckbox, mapNamesToIds } from "./formShared";

// ── Cabinet (author) helpers ─────────────────────────────────────────────────

const CABINET_STATUS: Record<CabinetDraft["status"], PatternStatus> = {
  DRAFT: { label: "Черновик", kind: "draft" },
  PENDING: { label: "На модерации", kind: "pending" },
  APPROVED: { label: "Одобрено", kind: "published" },
  REJECTED: { label: "Отклонено", kind: "rejected" },
};

function toRowItem(item: CabinetItem, authorName: string): AdminPatternItem {
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    category: item.categories.map((c) => c.name).join(", "),
    characteristics: item.tags.map((t) => t.name).join(", "),
    url: item.url,
    author: authorName,
    instrument: item.instruments.map((i) => i.name).join(", "),
    preview: item.imageUrl,
    isVisible: true,
    isNew: item.isNew,
    thickness: item.yarnRanges.map((y) => y.label).join(", ") || undefined,
    density: item.densityStitches != null && item.densityRows != null
      ? `${item.densityStitches} х ${item.densityRows}`
      : undefined,
  };
}

function statusOf(item: CabinetItem): PatternStatus {
  if (item._type === "pattern") return { label: "Опубликован", kind: "published" };
  const status = CABINET_STATUS[item.status];
  if (item.status === "REJECTED") {
    return { ...status, comment: item.moderationComment };
  }
  return status;
}

// ─────────────────────────────────────────────────────────────────────────────

interface PatternsProps {
  variant?: "admin" | "author";
}

export function Patterns({ variant = "admin" }: PatternsProps) {
  const isAuthor = variant === "author";

  const [data, setData] = useState<AdminPatternItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Pagination (admin only)
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [archiveCount, setArchiveCount] = useState(0);
  const observerTarget = useRef<HTMLDivElement>(null);

  // Local UI state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const [status, setStatus] = useState(isAuthor ? "all" : "active");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Moderation tab (admin only)
  const [drafts, setDrafts] = useState<AdminDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [rejectingDraft, setRejectingDraft] = useState<AdminDraft | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);

  // Cabinet (author) data
  const [cabinetPatterns, setCabinetPatterns] = useState<CabinetPattern[]>([]);
  const [cabinetDrafts, setCabinetDrafts] = useState<CabinetDraft[]>([]);
  const [cabinetLoading, setCabinetLoading] = useState(true);
  const [creatingEditFor, setCreatingEditFor] = useState<string | null>(null);
  const [authorEditingDraft, setAuthorEditingDraft] = useState<CabinetDraft | null>(null);
  const [currentAuthorName, setCurrentAuthorName] = useState("");

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
    images: [] as string[],
    details: "",
    price: "",
    oldPrice: "",
    isFree: false,
    isNew: false,
    categories: [] as string[],
    tags: [] as string[],
    instruments: [] as string[],
    yarnRangeIds: [] as string[],
    densityStitches: "",
    densityRows: "",
  });

  const [categoriesList, setCategoriesList] = useState<DictionaryItem[]>([]);
  const [tagsList, setTagsList] = useState<DictionaryItem[]>([]);
  const [instrumentsList, setInstrumentsList] = useState<DictionaryItem[]>([]);
  const [yarnRangesList, setYarnRangesList] = useState<YarnRange[]>([]);

  useEffect(() => {
    if (isAuthor) return;
    fixArchiveQuotes().catch(() => { });
  }, [isAuthor]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (isAuthor) return;
    if (status === "moderation") {
      loadDrafts();
    } else {
      setPage(1);
      loadPatterns(1);
    }
  }, [isAuthor, status, debouncedSearchQuery]);

  useEffect(() => {
    loadDictionaries();
    if (isAuthor) {
      loadCabinetItems();
      getCabinetAuthor()
        .then(({ author }) => setCurrentAuthorName(author.name))
        .catch(() => { });
    } else {
      loadAuthors();
      loadStatusCounts();
      loadDrafts();
    }
  }, [isAuthor]);

  const loadDrafts = async () => {
    try {
      setDraftsLoading(true);
      const res = await getAdminDrafts("PENDING");
      setDrafts(res);
    } catch {
      toast.error("Не удалось загрузить очередь модерации");
    } finally {
      setDraftsLoading(false);
    }
  };

  const loadStatusCounts = async () => {
    try {
      const [active, archive] = await Promise.all([
        getPatterns(1, 1, "active"),
        getPatterns(1, 1, "archive"),
      ]);
      setActiveCount(active.total);
      setArchiveCount(archive.total);
    } catch (err) {
      console.error("Failed to load status counts", err);
    }
  };

  const loadDictionaries = async () => {
    try {
      const [c, t, i, y] = await Promise.all([getCategories(), getTags(), getInstruments(), getYarnRanges()]);
      setCategoriesList(c);
      setTagsList(t);
      setInstrumentsList(i);
      setYarnRangesList(y);
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

  const loadCabinetItems = useCallback(async () => {
    try {
      setCabinetLoading(true);
      const res = await getCabinetItems();
      setCabinetDrafts(res.drafts);
      setCabinetPatterns(res.patterns);
    } catch {
      toast.error("Не удалось загрузить данные");
    } finally {
      setCabinetLoading(false);
    }
  }, []);

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
    if (isAuthor) return;
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
  }, [isAuthor, isFetchingMore, page, totalPages, status, debouncedSearchQuery, viewMode]);

  const cabinetAll: CabinetItem[] = useMemo(() => [
    ...cabinetPatterns.map((p) => p as CabinetItem),
    ...cabinetDrafts.map((d) => d as CabinetItem),
  ], [cabinetPatterns, cabinetDrafts]);

  const cabinetCounts = useMemo(() => ({
    all: cabinetAll.length,
    published: cabinetPatterns.length,
    draft: cabinetDrafts.filter((d) => d.status === "DRAFT").length,
    pending: cabinetDrafts.filter((d) => d.status === "PENDING").length,
    rejected: cabinetDrafts.filter((d) => d.status === "REJECTED").length,
  }), [cabinetAll, cabinetPatterns, cabinetDrafts]);

  const filteredCabinetItems: CabinetItem[] = useMemo(() => {
    let list: CabinetItem[];
    switch (status) {
      case "published": list = cabinetPatterns; break;
      case "draft": list = cabinetDrafts.filter((d) => d.status === "DRAFT"); break;
      case "moderation": list = cabinetDrafts.filter((d) => d.status === "PENDING"); break;
      case "rejected": list = cabinetDrafts.filter((d) => d.status === "REJECTED"); break;
      default: list = cabinetAll;
    }
    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.trim().toLowerCase();
      list = list.filter((item) => item.title.toLowerCase().includes(q));
    }
    return list;
  }, [status, cabinetAll, cabinetPatterns, cabinetDrafts, debouncedSearchQuery]);

  const filteredDrafts: AdminDraft[] = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return drafts;
    const q = debouncedSearchQuery.trim().toLowerCase();
    return drafts.filter(
      (d) => d.title.toLowerCase().includes(q) || d.author.name.toLowerCase().includes(q)
    );
  }, [drafts, debouncedSearchQuery]);

  const handleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    if (isAuthor) {
      setSelectedIds(new Set(filteredCabinetItems.map((item) => item.id)));
    } else {
      setSelectedIds(new Set(data.map((item) => item.id)));
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
    setAuthorEditingDraft(null);
    setFormData({
      title: "",
      authorName: isAuthor ? currentAuthorName : "",
      url: "",
      images: [],
      details: "",
      price: "",
      oldPrice: "",
      isFree: false,
      isNew: false,
      categories: [],
      tags: [],
      instruments: [],
      yarnRangeIds: [],
      densityStitches: "",
      densityRows: "",
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
        // Loaded galleries can carry more than the 5-photo save limit
        // (scraped drafts, legacy data) — trim on load so what's shown
        // always matches what a save will actually persist.
        images: (res.images || []).slice(0, 5),
        details: res.details || "",
        price: res.price != null ? String(res.price) : "",
        oldPrice: res.oldPrice != null ? String(res.oldPrice) : "",
        isFree: res.isFree || false,
        isNew: res.isNew || false,
        categories: (res.categories || []).map(c => c?.name || ""),
        tags: (res.tags || []).map(t => t?.name || ""),
        instruments: (res.instruments || []).map(i => i?.name || ""),
        yarnRangeIds: (res.yarnRanges || []).map(y => y.id),
        densityStitches: res.densityStitches != null ? String(res.densityStitches) : "",
        densityRows: res.densityRows != null ? String(res.densityRows) : "",
      };
      setFormData(loaded);
      originalFormDataRef.current = { ...loaded, categories: [...loaded.categories], tags: [...loaded.tags], instruments: [...loaded.instruments], images: [...loaded.images] };
      setEditingId(id);
      setIsModalOpen(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to load pattern details");
    }
  };

  const handleAuthorEditDraft = (draft: CabinetDraft) => {
    setFormData({
      title: draft.title,
      authorName: currentAuthorName,
      url: draft.url,
      images: draft.images.slice(0, 5),
      details: draft.details || "",
      price: draft.price != null ? String(draft.price) : "",
      oldPrice: draft.oldPrice != null ? String(draft.oldPrice) : "",
      isFree: draft.isFree,
      isNew: draft.isNew,
      categories: draft.categories.map((c) => c.name),
      tags: draft.tags.map((t) => t.name),
      instruments: draft.instruments.map((i) => i.name),
      yarnRangeIds: draft.yarnRanges.map((y) => y.id),
      densityStitches: draft.densityStitches != null ? String(draft.densityStitches) : "",
      densityRows: draft.densityRows != null ? String(draft.densityRows) : "",
    });
    setAuthorEditingDraft(draft);
    setEditingId(draft.id);
    setIsModalOpen(true);
  };

  const handleAuthorEditPattern = async (patternId: string) => {
    try {
      setCreatingEditFor(patternId);
      const draft = await createEditDraft(patternId);
      setCabinetDrafts((prev) => [draft, ...prev]);
      handleAuthorEditDraft(draft);
    } catch (err: any) {
      toast.error(err.message || "Ошибка при создании черновика");
    } finally {
      setCreatingEditFor(null);
    }
  };

  const handleAuthorSubmit = async (submitToModeration: boolean) => {
    if (!formData.title || !formData.url || formData.images.length === 0) {
      toast.error("Пожалуйста, заполните все обязательные поля");
      return;
    }

    if (submitToModeration && formData.categories.length === 0) {
      toast.error("Пожалуйста, заполните все обязательные поля");
      return;
    }

    try {
      setIsSaving(true);
      const payload = {
        title: formData.title.trim(),
        url: formData.url.trim(),
        images: formData.images,
        details: formData.details.trim() || null,
        price: formData.price.trim() || null,
        oldPrice: formData.oldPrice.trim() || null,
        isFree: formData.isFree,
        isNew: formData.isNew,
        categories: mapNamesToIds(formData.categories, categoriesList),
        tags: mapNamesToIds(formData.tags, tagsList),
        instruments: mapNamesToIds(formData.instruments, instrumentsList),
        yarnRangeIds: formData.yarnRangeIds,
        densityStitches: formData.densityStitches.trim(),
        densityRows: formData.densityRows.trim(),
      };

      let saved: CabinetDraft = authorEditingDraft
        ? await updateCabinetDraft(authorEditingDraft.id, payload)
        : await createCabinetDraft(payload);

      if (submitToModeration) {
        await submitCabinetDraft(saved.id);
        saved = { ...saved, status: "PENDING" };
        toast.success("Отправлено на модерацию");
      } else {
        toast.success("Сохранено");
      }

      setCabinetDrafts((prev) => {
        const idx = prev.findIndex((d) => d.id === saved.id);
        if (idx === -1) return [saved, ...prev];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      setIsModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Ошибка при сохранении");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent, isVisible = false) => {
    e.preventDefault();

    if (isAuthor) {
      await handleAuthorSubmit(isVisible);
      return;
    }

    if (!formData.title || !formData.url || formData.images.length === 0 || !formData.authorName) {
      toast.error("Пожалуйста, заполните все обязательные поля");
      return;
    }

    const willBePublished = editingId ? status !== "archive" : isVisible;
    if (willBePublished && formData.categories.length === 0) {
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
        if (!orig || JSON.stringify(formData.images) !== JSON.stringify(orig.images)) payload.images = formData.images;
        if (!orig || formData.details !== orig.details) payload.details = formData.details.trim() || null;
        if (!orig || formData.price !== orig.price) payload.price = formData.price.trim() || null;
        if (!orig || formData.oldPrice !== orig.oldPrice) payload.oldPrice = formData.oldPrice.trim() || null;
        if (!orig || formData.authorName !== orig.authorName) payload.authorName = formData.authorName;
        if (!orig || formData.isFree !== orig.isFree) payload.isFree = formData.isFree;
        if (!orig || formData.isNew !== orig.isNew) payload.isNew = formData.isNew;
        if (!orig || JSON.stringify(formData.categories) !== JSON.stringify(orig.categories)) payload.categories = formData.categories;
        if (!orig || JSON.stringify(formData.tags) !== JSON.stringify(orig.tags)) payload.tags = formData.tags;
        if (!orig || JSON.stringify(formData.instruments) !== JSON.stringify(orig.instruments)) payload.instruments = formData.instruments;
        if (!orig || JSON.stringify(formData.yarnRangeIds) !== JSON.stringify(orig.yarnRangeIds)) payload.yarnRangeIds = formData.yarnRangeIds;
        if (!orig || formData.densityStitches !== orig.densityStitches) payload.densityStitches = formData.densityStitches.trim();
        if (!orig || formData.densityRows !== orig.densityRows) payload.densityRows = formData.densityRows.trim();

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
            thickness: yarnRangesList
              .filter((y) => formData.yarnRangeIds.includes(y.id))
              .map((y) => y.label)
              .join(", ") || undefined,
            density: formData.densityStitches.trim() && formData.densityRows.trim()
              ? `${formData.densityStitches.trim()} х ${formData.densityRows.trim()}`
              : undefined,
          };
        }));
        toast.success("Описание успешно обновлено");
      } else {
        await createPattern({
          ...formData,
          details: formData.details.trim() || null,
          price: formData.price.trim() || null,
          oldPrice: formData.oldPrice.trim() || null,
          isVisible,
        });
        toast.success(isVisible ? "Описание опубликовано" : "Описание сохранено как черновик");
        setPage(1);
        await loadPatterns(1);
        loadStatusCounts();
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
      loadStatusCounts();
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error(err.message || "Failed to restore patterns");
    }
  };

  // Per-card actions for the grid view (mirrors the bulk "Удалить"/"Опубликовать"
  // actions, but for a single item with no selection/confirm step — same
  // immediate-action UX as the moderation tab's approve/reject buttons).
  const handleArchiveOne = async (id: string) => {
    try {
      await deletePattern(id);
      setData(prev => prev.filter(item => item.id !== id));
      loadStatusCounts();
      toast.success("Описание перемещено в архив");
    } catch (err: any) {
      toast.error(err.message || "Не удалось переместить в архив");
    }
  };

  const handlePublishOne = async (id: string) => {
    try {
      await updatePatternById(id, { isVisible: true });
      setData(prev => prev.filter(item => item.id !== id));
      loadStatusCounts();
      toast.success("Описание опубликовано");
    } catch (err: any) {
      toast.error(err.message || "Не удалось опубликовать");
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

  const handleApproveDraft = async (id: string) => {
    try {
      await approveDraft(id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      toast.success("Описание опубликовано");
      setPage(1);
      loadPatterns(1);
      loadStatusCounts();
    } catch (err: any) {
      toast.error(err.message || "Не удалось опубликовать");
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setConfirmOpen(true);
  };

  const confirmDeleteSelected = async () => {
    setConfirmOpen(false);
    if (isAuthor) {
      await confirmAuthorDeleteSelected();
      return;
    }
    try {
      await Promise.all(Array.from(selectedIds).map(id => deletePattern(id)));
      setData(prev => prev.filter(item => !selectedIds.has(item.id)));
      setSelectedIds(new Set());
      loadStatusCounts();
      if (status === "archive") {
        toast.success("Описания успешно удалены навсегда");
      } else {
        toast.success("Описания успешно скрыты");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete patterns");
    }
  };

  const handleAuthorPublishSelected = async () => {
    if (selectedIds.size === 0) return;
    const eligible = cabinetDrafts.filter(
      (d) => selectedIds.has(d.id) && (d.status === "DRAFT" || d.status === "REJECTED")
    );
    if (eligible.length === 0) {
      toast.error("Выберите черновики (не отправленные на модерацию)");
      return;
    }
    try {
      await Promise.all(eligible.map((d) => submitCabinetDraft(d.id)));
      setCabinetDrafts((prev) =>
        prev.map((d) => (eligible.some((e) => e.id === d.id) ? { ...d, status: "PENDING" as const } : d))
      );
      setSelectedIds(new Set());
      toast.success("Отправлено на модерацию");
    } catch (err: any) {
      toast.error(err.message || "Не удалось отправить на модерацию");
    }
  };

  const confirmAuthorDeleteSelected = async () => {
    const draftsToDelete = cabinetDrafts.filter((d) => selectedIds.has(d.id) && d.status !== "PENDING");
    const patternsToArchive = cabinetPatterns.filter((p) => selectedIds.has(p.id));
    if (draftsToDelete.length === 0 && patternsToArchive.length === 0) {
      toast.error("Нечего удалять — выбранные черновики на модерации");
      setSelectedIds(new Set());
      return;
    }
    try {
      await Promise.all([
        ...draftsToDelete.map((d) => deleteCabinetDraft(d.id)),
        ...patternsToArchive.map((p) => archiveCabinetPattern(p.id)),
      ]);
      setCabinetDrafts((prev) => prev.filter((d) => !draftsToDelete.some((x) => x.id === d.id)));
      setCabinetPatterns((prev) => prev.filter((p) => !patternsToArchive.some((x) => x.id === p.id)));
      setSelectedIds(new Set());
      toast.success("Готово");
    } catch (err: any) {
      toast.error(err.message || "Не удалось выполнить действие");
    }
  };

  const formReadonly = isAuthor && authorEditingDraft?.status === "PENDING";
  const modalTitle = formReadonly
    ? "Описание (на модерации)"
    : editingId ? "Редактировать описание" : "Новое описание";

  return (
    <div className={styles.container}>
      <PageHeader
        title={isAuthor ? "Мои описания" : "Описания"}
        search={{ value: searchQuery, onChange: setSearchQuery }}
        totalCount={
          isAuthor
            ? (cabinetLoading ? undefined : { label: "Всего описаний:", value: cabinetAll.length })
            : (totalCount !== null ? { label: "Всего описаний:", value: totalCount } : undefined)
        }
      />

      <ControlPanel
        tabs={isAuthor ? [
          {
            value: "all",
            label: "Все",
            count: cabinetCounts.all
          },
          {
            value: "published",
            label: "Опубликовано",
            prefix: <Check size={12} strokeWidth={1} color="#ffffffff" />,
            prefixColor: "#A9AE36",
            count: cabinetCounts.published
          },
          {
            value: "draft",
            label: "Черновики",
            prefix: <Pen size={12} strokeWidth={1} color="#000000" />,
            prefixColor: "#E5E5E5",
            count: cabinetCounts.draft
          },
          {
            value: "moderation",
            label: "На модерации",
            prefix: <Shield size={12} strokeWidth={1} color="#000000" />,
            prefixColor: "#BEC1F4",
            count: cabinetCounts.pending,
          },
          {
            value: "rejected",
            label: "Отклонено",
            prefix: <ShieldX size={12} strokeWidth={1} color="#ffffffff" />,
            prefixColor: "#D8520F",
            count: cabinetCounts.rejected
          },
        ] : [
          {
            value: "active",
            label: "Опубликованные",
            count: activeCount
          },
          {
            value: "archive",
            label: "Архивные",
            count: archiveCount
          },
          {
            value: "moderation",
            label: "На модерации",
            prefix: <Shield size={12} strokeWidth={1} color="#000000" />,
            prefixColor: "#BEC1F4",
            count: drafts.length,
          },
        ]}
        activeTab={status}
        onTabChange={(v) => setStatus(v)}
        actions={
          isAuthor ? (
            <>
              <ControlPanelBtn
                variant="add"
                icon={<Plus size={24} strokeWidth={1} />}
                onClick={handleOpenCreate}
              >
                Добавить описание
              </ControlPanelBtn>
              <ControlPanelBtn
                variant="neutral"
                disabled={selectedIds.size === 0}
                onClick={handleAuthorPublishSelected}
              >
                Отправить на модерацию
              </ControlPanelBtn>
              <ControlPanelBtn
                variant="danger"
                disabled={selectedIds.size === 0}
                onClick={handleDeleteSelected}
              >
                Удалить
              </ControlPanelBtn>
            </>
          ) : (
            <>
              <ControlPanelBtn
                variant="add"
                icon={<Plus size={24} strokeWidth={1} />}
                onClick={handleOpenCreate}
              >
                Добавить описание
              </ControlPanelBtn>
              <ControlPanelBtn variant="neutral" onClick={() => setResetNewConfirmOpen(true)}>
                Убрать статус «Новинка»
              </ControlPanelBtn>
              {viewMode === "list" && status === "archive" && (
                <ControlPanelBtn
                  variant="neutral"
                  disabled={selectedIds.size === 0}
                  onClick={handleRestoreSelected}
                >
                  Опубликовать
                </ControlPanelBtn>
              )}
              {viewMode === "list" && (
                <ControlPanelBtn
                  variant="danger"
                  disabled={selectedIds.size === 0}
                  onClick={handleDeleteSelected}
                >
                  Удалить
                </ControlPanelBtn>
              )}
              {status !== "moderation" && (
                <ViewToggle value={viewMode} onChange={setViewMode} />
              )}
            </>
          )
        }
      />

      {!isAuthor && status === "moderation" && (
        <div className={styles.moderationGrid}>
          {draftsLoading && <div className={styles.centerState}>Загрузка...</div>}
          {!draftsLoading && filteredDrafts.length === 0 && (
            <div className={styles.centerState}>
              {debouncedSearchQuery.trim() ? "Ничего не найдено" : "Очередь пуста"}
            </div>
          )}
          {!draftsLoading && filteredDrafts.map((draft) => (
            <ModerationCard
              key={draft.id}
              draft={draft}
              onApprove={handleApproveDraft}
              onReject={(d) => { setRejectingDraft(d); setRejectComment(""); }}
            />
          ))}
        </div>
      )}

      {(isAuthor || status !== "moderation") && (
        <>
          {!isAuthor && viewMode === "grid" ? (
            <div className={styles.moderationGrid}>
              {isLoading && <div className={styles.centerState}>Загрузка...</div>}

              {!isLoading && error && (
                <div className={styles.centerState} style={{ color: "#ef4444" }}>{error}</div>
              )}

              {!isLoading && !error && data.length === 0 && (
                <div className={styles.centerState}>Описаний пока нет</div>
              )}

              {!isLoading && !error && data.map((item) => (
                <PatternGridCard
                  key={item.id}
                  item={item}
                  onEdit={handleOpenEdit}
                  actionLabel={status === "archive" ? "Опубликовать" : "В архив"}
                  onAction={status === "archive" ? handlePublishOne : handleArchiveOne}
                />
              ))}

              {page < totalPages && (
                <div ref={observerTarget} style={{ padding: 20, textAlign: "center", color: "#6b7280", gridColumn: "1 / -1" }}>
                  Загрузка...
                </div>
              )}
            </div>
          ) : (
            <div className={styles.tableWrapper}>
              <PatternCardHeader
                allSelected={
                  isAuthor
                    ? filteredCabinetItems.length > 0 && filteredCabinetItems.every((item) => selectedIds.has(item.id))
                    : data.length > 0 && selectedIds.size === data.length
                }
                onSelectAll={handleSelectAll}
              />

              {isAuthor ? (
                <>
                  {cabinetLoading && (
                    <div className={styles.centerState}>Загрузка...</div>
                  )}

                  {!cabinetLoading && filteredCabinetItems.length === 0 && (
                    <div className={styles.centerState}>Описаний пока нет</div>
                  )}

                  {!cabinetLoading && filteredCabinetItems.map((item) => (
                    <PatternCard
                      key={`${item._type}-${item.id}`}
                      item={toRowItem(item, currentAuthorName)}
                      status={statusOf(item)}
                      isSelected={selectedIds.has(item.id)}
                      onSelect={handleSelectRow}
                      editDisabled={(item._type === "draft" && item.status === "PENDING") || creatingEditFor === item.id}
                      onEdit={() =>
                        item._type === "pattern"
                          ? handleAuthorEditPattern(item.id)
                          : handleAuthorEditDraft(item)
                      }
                    />
                  ))}
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}

          <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={modalTitle} maxWidth={760}>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 30 }}>

              {isAuthor && authorEditingDraft?.status === "REJECTED" && authorEditingDraft.moderationComment && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 12, fontFamily: "Mulish", fontSize: 13, color: "#b91c1c" }}>
                  <strong>Отклонено модератором:</strong> {authorEditingDraft.moderationComment}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 20, rowGap: 30 }}>

                {/* Название */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={labelStyle}>Название <span style={{ color: "#ef4444" }}>*</span></label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                    style={inputStyle}
                    placeholder="Название"
                    required
                    disabled={formReadonly}
                  />
                </div>

                {/* Категория */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={labelStyle}>Категория <span style={{ color: "#ef4444" }}>*</span></label>
                  <CreatableSelect
                    isMulti
                    isDisabled={formReadonly}
                    isValidNewOption={() => !isAuthor}
                    isOptionDisabled={() => formData.categories.length >= MAX_CATEGORIES}
                    styles={selectStyles}
                    options={categoriesList.map(c => ({ value: c.name, label: c.name }))}
                    value={formData.categories.map(c => ({ value: c, label: c }))}
                    onChange={(vals) => {
                      if (vals.length > MAX_CATEGORIES) {
                        toast.error(`Не более ${MAX_CATEGORIES} категорий`);
                        return;
                      }
                      setFormData({ ...formData, categories: vals.map(v => v.value) });
                    }}
                    placeholder="Категории"
                  />
                </div>

                {/* Новинка */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <ModalCheckbox
                    checked={formData.isNew}
                    onChange={v => setFormData({ ...formData, isNew: v })}
                    label="Новинка"
                  />
                </div>

                {/* Бесплатное */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <ModalCheckbox
                    checked={formData.isFree}
                    onChange={v => setFormData({ ...formData, isFree: v })}
                    label="Бесплатное"
                  />
                </div>

                {/* Характеристики */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={labelStyle}>Характеристики <span style={optionalStyle}></span></label>
                  <CreatableSelect
                    isMulti
                    isDisabled={formReadonly}
                    isValidNewOption={() => !isAuthor}
                    isOptionDisabled={() => formData.tags.length >= MAX_TAGS}
                    styles={selectStyles}
                    options={tagsList.map(t => ({ value: t.name, label: t.name }))}
                    value={formData.tags.map(t => ({ value: t, label: t }))}
                    onChange={(vals) => {
                      if (vals.length > MAX_TAGS) {
                        toast.error(`Не более ${MAX_TAGS} характеристик`);
                        return;
                      }
                      setFormData({ ...formData, tags: vals.map(v => v.value) });
                    }}
                    placeholder="Характеристики"
                  />
                </div>

                {/* Автор */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={labelStyle}>Автор <span style={{ color: "#ef4444" }}>*</span></label>
                  <CreatableSelect
                    isClearable
                    isDisabled={isAuthor || formReadonly}
                    styles={selectStyles}
                    options={authors.map(a => ({ value: a.name, label: a.name }))}
                    value={formData.authorName ? { value: formData.authorName, label: formData.authorName } : null}
                    onChange={(val) => setFormData({ ...formData, authorName: val?.value || "" })}
                    placeholder="Автор"
                  />
                </div>

                {/* Ссылка */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={labelStyle}>Ссылка <span style={{ color: "#ef4444" }}>*</span></label>
                  <input
                    type="url"
                    value={formData.url}
                    onChange={e => setFormData({ ...formData, url: e.target.value })}
                    style={inputStyle}
                    placeholder="Вставить ссылку"
                    required
                    disabled={formReadonly}
                  />
                </div>

                {/* Инструмент */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={labelStyle}>Инструмент <span style={optionalStyle}></span></label>
                  <CreatableSelect
                    isMulti
                    isDisabled={formReadonly}
                    isValidNewOption={() => !isAuthor}
                    styles={selectStyles}
                    options={instrumentsList.map(i => ({ value: i.name, label: i.name }))}
                    value={formData.instruments.map(i => ({ value: i, label: i }))}
                    onChange={(vals) => setFormData({ ...formData, instruments: vals.map(v => v.value) })}
                    placeholder="Инструмент"
                  />
                </div>

                {/* Толщина пряжи */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={labelStyle}>Толщина пряжи (м/100г) <span style={optionalStyle}>(необязательно)</span></label>
                  <CreatableSelect
                    isMulti
                    isDisabled={formReadonly}
                    isValidNewOption={() => false}
                    styles={selectStyles}
                    options={yarnRangesList.map(y => ({ value: y.id, label: y.label }))}
                    value={yarnRangesList
                      .filter(y => formData.yarnRangeIds.includes(y.id))
                      .map(y => ({ value: y.id, label: y.label }))}
                    onChange={(vals) => setFormData({ ...formData, yarnRangeIds: vals.map(v => v.value) })}
                    placeholder="Диапазон толщины"
                  />
                </div>

                {/* Плотность */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={labelStyle}>Плотность (петли × ряды) в лицевой глади <span style={optionalStyle}></span></label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      value={formData.densityStitches}
                      onChange={e => setFormData({ ...formData, densityStitches: e.target.value })}
                      style={{ ...inputStyle, width: "calc(50% - 16px)" }}
                      placeholder=""
                      min={0}
                      step="any"
                      disabled={formReadonly}
                    />
                    <span style={{ fontFamily: "Mulish", fontSize: 14, color: "#1d1c1c", flexShrink: 0 }}>×</span>
                    <input
                      type="number"
                      value={formData.densityRows}
                      onChange={e => setFormData({ ...formData, densityRows: e.target.value })}
                      style={{ ...inputStyle, width: "calc(50% - 16px)" }}
                      placeholder=""
                      min={0}
                      step="any"
                      disabled={formReadonly}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ width: "calc(50% - 16px)", fontFamily: "Mulish", fontSize: 12, color: "#9b9a9a" }}>Петли</span>
                    <span style={{ width: 16 }} />
                    <span style={{ width: "calc(50% - 16px)", fontFamily: "Mulish", fontSize: 12, color: "#9b9a9a" }}>Ряды</span>
                  </div>
                </div>

                {/* Цена / старая цена — oldPrice заполнена только когда реально есть скидка */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={labelStyle}>Цена, ₽ <span style={optionalStyle}>(необязательно)</span></label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      value={formData.price}
                      onChange={e => setFormData({ ...formData, price: e.target.value })}
                      style={{ ...inputStyle, width: "calc(50% - 16px)" }}
                      placeholder=""
                      min={0}
                      disabled={formReadonly}
                    />
                    <span style={{ width: 8, flexShrink: 0 }} />
                    <input
                      type="number"
                      value={formData.oldPrice}
                      onChange={e => setFormData({ ...formData, oldPrice: e.target.value })}
                      style={{ ...inputStyle, width: "calc(50% - 16px)" }}
                      placeholder=""
                      min={0}
                      disabled={formReadonly}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ width: "calc(50% - 16px)", fontFamily: "Mulish", fontSize: 12, color: "#9b9a9a" }}>Текущая</span>
                    <span style={{ width: 16 }} />
                    <span style={{ width: "calc(50% - 16px)", fontFamily: "Mulish", fontSize: 12, color: "#9b9a9a" }}>Старая (если скидка)</span>
                  </div>
                </div>

                {/* Фото (до 5, первое — обложка) */}
                {!formReadonly && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <label style={labelStyle}>Фото <span style={{ color: "#ef4444" }}>*</span></label>
                    <ImageGalleryManager
                      images={formData.images}
                      onChange={(images) => setFormData({ ...formData, images })}
                    />
                  </div>
                )}

                {/* Подробности — длинный текст, во всю ширину формы */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>Подробности <span style={optionalStyle}>(необязательно)</span></label>
                  <textarea
                    value={formData.details}
                    onChange={e => setFormData({ ...formData, details: e.target.value })}
                    style={{ ...inputStyle, height: 160, resize: "vertical", paddingTop: 12, paddingBottom: 12 }}
                    placeholder="Подробное описание — материалы, техника, размеры и т.п."
                    disabled={formReadonly}
                  />
                </div>

              </div>

              {/* Кнопки */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 20 }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={btnStyle("#f3f3f3", "#1d1c1c")}
                >
                  Закрыть
                </button>
                {!formReadonly && (
                  <>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={(e) => handleSubmit(e as any, false)}
                      style={btnStyle("#bec1f4", "#1d1c1c")}
                    >
                      {isSaving ? "Сохранение..." : "Сохранить"}
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={(e) => handleSubmit(e as any, true)}
                      style={btnStyle("#a9ae36", "#ffffff")}
                    >
                      {isAuthor ? "Отправить на модерацию" : "Опубликовать"}
                    </button>
                  </>
                )}
              </div>
            </form>
          </Modal>

          <ConfirmDialog
            isOpen={confirmOpen}
            title={isAuthor ? "Удалить выбранное" : status === "archive" ? "Удалить навсегда" : "Скрыть описания"}
            message={
              isAuthor
                ? `Черновики (${selectedIds.size} шт.) будут удалены безвозвратно, опубликованные описания — перемещены в архив. Черновики на модерации не будут затронуты.`
                : status === "archive"
                  ? `Вы уверены, что хотите удалить выбранные карточки (${selectedIds.size} шт.) навсегда? Это действие необратимо, картинка также будет удалена.`
                  : `Вы уверены, что хотите скрыть выбранные описания (${selectedIds.size} шт.)? Они переместятся в архив.`
            }
            confirmText={isAuthor ? "Удалить" : status === "archive" ? "Удалить" : "Скрыть"}
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

        </>
      )}

      {rejectingDraft && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
          <div style={{ background: "#fff", borderRadius: 12, width: 440, padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontFamily: "Mulish", fontWeight: 700, fontSize: 18, color: "#1a1a1a" }}>Причина отклонения</span>
              <button onClick={() => setRejectingDraft(null)} style={{ border: "none", background: "#f3f4f6", borderRadius: 6, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={16} color="#6b7280" />
              </button>
            </div>
            <p style={{ fontFamily: "Mulish", fontSize: 14, color: "#6b7280", margin: "0 0 12px" }}>
              {rejectingDraft.title}
            </p>
            <textarea
              autoFocus
              rows={4}
              placeholder="Укажите причину отклонения..."
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              style={{ width: "100%", padding: 12, border: "1px solid #e5e7eb", borderRadius: 8, fontFamily: "Mulish", fontSize: 14, resize: "vertical", outline: "none", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button
                onClick={() => setRejectingDraft(null)}
                style={{ height: 38, padding: "0 16px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", fontFamily: "Mulish", fontSize: 14, cursor: "pointer" }}
              >
                Закрыть
              </button>
              <button
                disabled={!rejectComment.trim() || isRejecting}
                onClick={async () => {
                  if (!rejectingDraft || !rejectComment.trim()) return;
                  setIsRejecting(true);
                  try {
                    await rejectDraft(rejectingDraft.id, rejectComment.trim());
                    setDrafts((prev) => prev.filter((d) => d.id !== rejectingDraft.id));
                    toast.success("Черновик отклонён");
                    setRejectingDraft(null);
                  } catch (err: any) {
                    toast.error(err.message || "Не удалось отклонить");
                  } finally {
                    setIsRejecting(false);
                  }
                }}
                style={{ height: 38, padding: "0 20px", border: "none", borderRadius: 8, background: "#ef4444", color: "#fff", fontFamily: "Mulish", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: !rejectComment.trim() || isRejecting ? 0.5 : 1 }}
              >
                {isRejecting ? "Отклонение..." : "Отклонить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
