import { useEffect, useState } from "react";
import { Plus, Trash2, SquarePen, Search, ShieldCheck, Bug, Signal } from "lucide-react";
import {
  getWhitelist,
  createWhitelistEntry,
  updateWhitelistEntry,
  deleteWhitelistEntry,
  checkWhitelistSubscription,
  WhitelistEntry,
} from "../../api/whitelist";
import { Modal } from "../../components/Modal/Modal";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import toast from "react-hot-toast";
import styles from "./Whitelist.module.css";

interface FormData {
  telegramId: string;
  username: string;
  firstName: string;
  lastName: string;
  comment: string;
  forceAllow: boolean;
  debugLogging: boolean;
}

const EMPTY_FORM: FormData = {
  telegramId: "",
  username: "",
  firstName: "",
  lastName: "",
  comment: "",
  forceAllow: true,
  debugLogging: false,
};

export function Whitelist() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<WhitelistEntry | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<WhitelistEntry | null>(null);

  const [checkingSubId, setCheckingSubId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    loadEntries();
  }, [debouncedSearch]);

  const loadEntries = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getWhitelist(debouncedSearch);
      setEntries(data);
    } catch (err: any) {
      setError(err.message || "Не удалось загрузить белый список");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingEntry(null);
    setFormData(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (entry: WhitelistEntry) => {
    setEditingEntry(entry);
    setFormData({
      telegramId: entry.telegramId,
      username: entry.username ?? "",
      firstName: entry.firstName ?? "",
      lastName: entry.lastName ?? "",
      comment: entry.comment ?? "",
      forceAllow: entry.forceAllow,
      debugLogging: entry.debugLogging,
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.telegramId.trim()) return;

    try {
      setIsSaving(true);
      if (editingEntry) {
        await updateWhitelistEntry(editingEntry.id, {
          username: formData.username || undefined,
          firstName: formData.firstName || undefined,
          lastName: formData.lastName || undefined,
          comment: formData.comment || undefined,
          forceAllow: formData.forceAllow,
          debugLogging: formData.debugLogging,
        });
        toast.success("Запись обновлена");
      } else {
        await createWhitelistEntry({
          telegramId: formData.telegramId.trim(),
          username: formData.username || undefined,
          firstName: formData.firstName || undefined,
          lastName: formData.lastName || undefined,
          comment: formData.comment || undefined,
          forceAllow: formData.forceAllow,
          debugLogging: formData.debugLogging,
        });
        toast.success("Пользователь добавлен в белый список");
      }
      setIsModalOpen(false);
      await loadEntries();
    } catch (err: any) {
      toast.error(err.message || "Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearInvestigation = async () => {
    if (!editingEntry) return;
    try {
      setIsSaving(true);
      await updateWhitelistEntry(editingEntry.id, { needsInvestigation: false });
      toast.success("Отметка снята");
      setIsModalOpen(false);
      await loadEntries();
    } catch (err: any) {
      toast.error(err.message || "Не удалось снять отметку");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckSubscription = async (e: React.MouseEvent, entry: WhitelistEntry) => {
    e.stopPropagation();
    setCheckingSubId(entry.id);
    try {
      const result = await checkWhitelistSubscription(entry.id);
      const { telegramStatus, telegramOk, isParticipantIdInvalid, isSubscriber, gatewayStatusCode, gatewayDurationMs } = result;
      const ms = gatewayDurationMs != null ? ` (${gatewayDurationMs}ms)` : "";

      if (isParticipantIdInvalid) {
        toast.error(`PARTICIPANT_ID_INVALID${ms}`, { duration: 7000 });
      } else if (telegramOk === false) {
        toast.error(`Telegram error: HTTP ${gatewayStatusCode}${ms}`, { duration: 7000 });
      } else if (telegramStatus === "member" || telegramStatus === "creator" || telegramStatus === "administrator") {
        toast.success(`Подписан — ${telegramStatus}${ms}`, { duration: 5000 });
      } else if (telegramStatus !== null) {
        toast.error(`Не подписан — ${telegramStatus}${ms}`, { duration: 6000 });
      } else if (isSubscriber) {
        toast(`Gateway недоступен — ответ не получен${ms}`, { icon: "⚠️", duration: 6000 });
      } else {
        toast.error(`Не подписан${ms}`, { duration: 6000 });
      }
    } catch (err: any) {
      toast.error(err.message || "Ошибка проверки подписки");
    } finally {
      setCheckingSubId(null);
    }
  };

  const handleDelete = (entry: WhitelistEntry) => {
    setEntryToDelete(entry);
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    setConfirmOpen(false);
    if (!entryToDelete) return;
    try {
      await deleteWhitelistEntry(entryToDelete.id);
      toast.success("Пользователь удалён из белого списка");
      await loadEntries();
    } catch (err: any) {
      toast.error(err.message || "Не удалось удалить");
    } finally {
      setEntryToDelete(null);
    }
  };

  const displayName = (entry: WhitelistEntry) =>
    [entry.firstName, entry.lastName].filter(Boolean).join(" ") || "—";

  if (isLoading && entries.length === 0) {
    return <div className={styles.centerState}>Загрузка...</div>;
  }

  if (error && entries.length === 0) {
    return (
      <div className={styles.centerState} style={{ color: "#ef4444" }}>
        {error}
        <button className={styles.btnSecondary} onClick={loadEntries} style={{ marginTop: 12 }}>
          Попробовать снова
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>Белый список</h1>
        <div className={styles.searchWrapper}>
          <input
            type="text"
            placeholder="Поиск по ID, имени, username"
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search size={18} color="#9ca3af" />
        </div>
      </div>

      <div className={styles.controlsPanel}>
        <div />
        <div className={styles.rightControls}>
          <button className={styles.btnAdd} onClick={handleOpenCreate}>
            <Plus size={16} />
            Добавить пользователя
          </button>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Telegram ID</th>
              <th>Username</th>
              <th>Имя</th>
              <th>Комментарий</th>
              <th title="Разрешить вход без подписки">Доступ</th>
              <th title="Полное логирование авторизации">Отладка</th>
              <th>Добавлен</th>
              <th style={{ width: 112 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className={styles.tableRow} onClick={() => handleOpenEdit(entry)}>
                <td className={styles.tdText}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {entry.telegramId}
                    {entry.needsInvestigation && (
                      <span
                        className={styles.investigationDot}
                        title="Был авторизован через белый список — требует проверки"
                      />
                    )}
                  </span>
                </td>
                <td className={styles.tdText}>
                  {entry.username ? `@${entry.username}` : <span className={styles.tdMuted}>—</span>}
                </td>
                <td className={styles.tdText}>{displayName(entry)}</td>
                <td className={styles.tdMuted}>{entry.comment || "—"}</td>
                <td>
                  {entry.forceAllow ? (
                    <span title="Вход разрешён"><ShieldCheck size={18} color="#83942C" /></span>
                  ) : (
                    <span className={styles.tdMuted}>—</span>
                  )}
                </td>
                <td>
                  {entry.debugLogging ? (
                    <span title="Отладка включена"><Bug size={18} color="#f59e0b" /></span>
                  ) : (
                    <span className={styles.tdMuted}>—</span>
                  )}
                </td>
                <td className={styles.tdMuted}>
                  {new Date(entry.createdAt).toLocaleDateString("ru-RU")}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      className={styles.iconBtn}
                      title="Проверить подписку"
                      disabled={checkingSubId === entry.id}
                      onClick={(e) => handleCheckSubscription(e, entry)}
                      style={{ color: "#6366f1" }}
                    >
                      <Signal size={16} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      title="Редактировать"
                      onClick={() => handleOpenEdit(entry)}
                    >
                      <SquarePen size={16} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      title="Удалить"
                      onClick={() => handleDelete(entry)}
                      style={{ color: "#ef4444" }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {entries.length === 0 && !isLoading && (
              <tr>
                <td colSpan={8} className={styles.centerState}>
                  Белый список пуст
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingEntry ? "Редактировать запись" : "Добавить в белый список"}
      >
        <form onSubmit={handleSave} className={styles.form}>
          {editingEntry?.needsInvestigation && (
            <div className={styles.investigationBanner}>
              <span>⚠️</span>
              <div>
                <div>Пользователь был авторизован через белый список (без реальной подписки). Проверьте и снимите отметку.</div>
                {editingEntry.lastWhitelistAuthorizationAt && (
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                    Последний вход:{" "}
                    {new Date(editingEntry.lastWhitelistAuthorizationAt).toLocaleString("ru-RU", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className={styles.formGroup}>
            <label>
              Telegram ID <span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d+"
              value={formData.telegramId}
              onChange={(e) => setFormData({ ...formData, telegramId: e.target.value })}
              className={styles.input}
              placeholder="123456789"
              required
              disabled={!!editingEntry}
              autoFocus={!editingEntry}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Username</label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className={styles.input}
              placeholder="username (без @)"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Имя</label>
            <input
              type="text"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              className={styles.input}
              placeholder="Имя"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Фамилия</label>
            <input
              type="text"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              className={styles.input}
              placeholder="Фамилия"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Комментарий</label>
            <textarea
              value={formData.comment}
              onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
              className={styles.textarea}
              placeholder="Причина добавления, контекст..."
            />
          </div>
          <div className={styles.checkboxGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={formData.forceAllow}
                onChange={(e) => setFormData({ ...formData, forceAllow: e.target.checked })}
                className={styles.checkbox}
              />
              <span>
                <strong>Разрешить вход</strong> — пустить в приложение без подписки на канал
              </span>
            </label>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={formData.debugLogging}
                onChange={(e) => setFormData({ ...formData, debugLogging: e.target.checked })}
                className={styles.checkbox}
              />
              <span>
                <strong>Отладка</strong> — записывать полный лог авторизации в <code>auth-debug.log</code>
              </span>
            </label>
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} onClick={() => setIsModalOpen(false)}>
              Отмена
            </button>
            {editingEntry?.needsInvestigation && (
              <button
                type="button"
                className={styles.btnClearInvestigation}
                onClick={handleClearInvestigation}
                disabled={isSaving}
              >
                ✓ Расследовано
              </button>
            )}
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={isSaving || !formData.telegramId.trim()}
            >
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Удалить из белого списка"
        message={`Убрать пользователя ${entryToDelete?.telegramId ?? ""} из белого списка? Следующая попытка входа будет проверена через подписку.`}
        confirmText="Удалить"
        cancelText="Отмена"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => { setConfirmOpen(false); setEntryToDelete(null); }}
      />
    </div>
  );
}
