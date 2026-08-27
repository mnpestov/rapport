import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Loader2, Search } from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { Modal } from "../../components/Modal/Modal";
import { Button } from "../../components/Button/Button";
import { getPriceCheckRuns, getPriceCheckStatus, triggerPriceCheck, getConfirmedAuthors, PriceCheckRun } from "../../api/priceCheck";
import styles from "./PriceCheck.module.css";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) +
    " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatPrice(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("ru-RU");
}

// Название описания как ссылка на /patterns с применённым поиском по
// этому названию — так из отчёта проверки цен можно сразу найти и
// поправить нужное описание в админке. null — авторские (не привязанные
// к одному описанию) ошибки, ссылку строить не из чего.
function PatternSearchLink({ title }: { title: string | null }) {
  if (!title) return <>—</>;
  return <Link to={`/patterns?search=${encodeURIComponent(title)}`}>{title}</Link>;
}

function RunRow({ run }: { run: PriceCheckRun }) {
  const [expanded, setExpanded] = useState(false);
  const hasIssues = run.errorsCount > 0;
  const hasDetail = run.changes.length > 0 || run.errors.length > 0 || run.escalations.length > 0;

  return (
    <div className={styles.runCard}>
      <button
        className={styles.runHeader}
        onClick={() => setExpanded(v => !v)}
        disabled={!hasDetail}
      >
        <div className={styles.statusIcon}>
          {hasIssues ? (
            <AlertTriangle size={20} color="#D8540F" />
          ) : (
            <CheckCircle2 size={20} color="#83942C" />
          )}
        </div>
        <div className={styles.runTime}>{formatDateTime(run.startedAt)}</div>
        <div className={styles.runStats}>
          <span>проверено {run.checked}</span>
          <span>изменений {run.changed}</span>
          <span className={hasIssues ? styles.errorCount : undefined}>ошибок {run.errorsCount}</span>
          {run.escalations.length > 0 && (
            <span className={styles.escalationBadge}>⚠️ хронические: {run.escalations.length}</span>
          )}
        </div>
        {hasDetail && (expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />)}
      </button>

      {expanded && (
        <div className={styles.runDetail}>
          {run.changes.length > 0 && (
            <div className={styles.detailSection}>
              <div className={styles.detailTitle}>Изменения цены ({run.changes.length})</div>
              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    <th>Автор</th>
                    <th>Товар</th>
                    <th>Было</th>
                    <th>Стало</th>
                  </tr>
                </thead>
                <tbody>
                  {run.changes.map((c, i) => (
                    <tr key={i}>
                      <td>{c.author}</td>
                      <td><PatternSearchLink title={c.title} /></td>
                      <td>{formatPrice(c.oldPrice)} / {formatPrice(c.oldOldPrice)}</td>
                      <td>{formatPrice(c.newPrice)} / {formatPrice(c.newOldPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {run.errors.length > 0 && (
            <div className={styles.detailSection}>
              <div className={styles.detailTitle}>Ошибки ({run.errors.length})</div>
              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    <th>Автор</th>
                    <th>Название</th>
                    <th>Ссылка</th>
                    <th>Ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {run.errors.map((e, i) => (
                    <tr key={i}>
                      <td>{e.author}</td>
                      <td><PatternSearchLink title={e.title} /></td>
                      <td>
                        {e.url ? <a href={e.url} target="_blank" rel="noreferrer">ссылка</a> : "—"}
                      </td>
                      <td>{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {run.escalations.length > 0 && (
            <div className={styles.detailSection}>
              <div className={styles.detailTitle}>Хронические ошибки</div>
              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    <th>Автор</th>
                    <th>Название</th>
                    <th>Ссылка</th>
                    <th>Прогонов подряд</th>
                  </tr>
                </thead>
                <tbody>
                  {run.escalations.map((e, i) => (
                    <tr key={i}>
                      <td>{e.author}</td>
                      <td><PatternSearchLink title={e.title} /></td>
                      <td><a href={e.url} target="_blank" rel="noreferrer">ссылка</a></td>
                      <td>{e.runs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AuthorPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  authors: string[];
  onConfirm: (selected: string[]) => void;
}

function AuthorPickerModal({ isOpen, onClose, authors, onConfirm }: AuthorPickerModalProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Свежий чистый выбор при каждом открытии, а не остаток с прошлого раза.
  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelected(new Set());
    }
  }, [isOpen]);

  const filtered = authors.filter(a => a.toLowerCase().includes(search.trim().toLowerCase()));
  const allFilteredSelected = filtered.length > 0 && filtered.every(a => selected.has(a));

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach(a => next.delete(a));
      } else {
        filtered.forEach(a => next.add(a));
      }
      return next;
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Выбрать авторов" maxWidth={440}>
      <div className={styles.pickerSearchWrapper}>
        <Search size={18} className={styles.pickerSearchIcon} />
        <input
          type="text"
          className={styles.pickerSearchInput}
          placeholder="Поиск по имени автора"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <label className={styles.pickerSelectAll}>
        <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} />
        Выбрать все{search && " (найденные)"}
      </label>

      <div className={styles.pickerList}>
        {filtered.length === 0 && <div className={styles.pickerEmpty}>Ничего не найдено</div>}
        {filtered.map(name => (
          <label key={name} className={styles.pickerRow}>
            <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)} />
            {name}
          </label>
        ))}
      </div>

      <div className={styles.pickerFooter}>
        <span className={styles.pickerCount}>{selected.size > 0 ? `Выбрано: ${selected.size}` : ""}</span>
        <Button
          size="lg"
          disabled={selected.size === 0}
          onClick={() => onConfirm(Array.from(selected))}
        >
          Запустить
        </Button>
      </div>
    </Modal>
  );
}

export function PriceCheck() {
  const [runs, setRuns] = useState<PriceCheckRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [confirmedAuthors, setConfirmedAuthors] = useState<string[]>([]);

  const loadRuns = () => getPriceCheckRuns().then(setRuns);

  useEffect(() => {
    Promise.all([
      loadRuns(),
      getPriceCheckStatus().then(s => setIsRunning(s.isRunning)),
    ])
      .catch(() => setError("Не удалось загрузить историю проверок цены"))
      .finally(() => setLoading(false));

    // Отдельно от критического пути выше — если список подтверждённых
    // авторов не загрузится, история прогонов всё равно должна
    // отобразиться, просто кнопка выбора авторов будет недоступна.
    getConfirmedAuthors().then(setConfirmedAuthors).catch(console.error);
  }, []);

  // Полный прогон занимает десятки минут (~53 мин на последнем замере) —
  // не ждём ответа запроса, опрашиваем статус, как «Проверить новинки» на
  // странице авторов (тот же паттерн: isRunning + setInterval).
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(async () => {
      try {
        const { isRunning: stillRunning } = await getPriceCheckStatus();
        if (!stillRunning) {
          setIsRunning(false);
          try {
            await loadRuns();
            toast.success("Проверка цен завершена");
          } catch {
            toast.error("Проверка завершена, но не удалось обновить список");
          }
        }
      } catch (e) {
        console.error(e);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const handleTrigger = async (authors?: string[]) => {
    setIsTriggering(true);
    try {
      await triggerPriceCheck(authors);
      setIsPickerOpen(false);
      setIsRunning(true);
      toast.success(
        authors && authors.length > 0
          ? `Проверка запущена для ${authors.length} авторов`
          : "Проверка цен запущена в фоне"
      );
    } catch (err: any) {
      toast.error(err.message || "Ошибка при запуске");
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Скрипт цен"
        totalCount={{ label: "прогонов", value: runs.length }}
      />

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>Проверка цен — история прогонов</div>
            <div className={styles.sectionHint}>
              Автоматический джоб дважды в сутки перепроверяет цены на сайтах авторов
              (см. run_price_check.sh). Здесь — результат каждого прогона; в Telegram
              приходят только прогоны с ошибками или хроническими проблемами.
            </div>
          </div>
          <div className={styles.triggerActions}>
            <Button
              size="lg"
              onClick={() => handleTrigger()}
              disabled={isRunning || isTriggering}
            >
              {isRunning ? (
                <>
                  <Loader2 size={16} className={styles.spinner} />
                  Выполняется...
                </>
              ) : (
                "Запустить проверку"
              )}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => setIsPickerOpen(true)}
              disabled={isRunning || isTriggering || confirmedAuthors.length === 0}
            >
              Выбрать авторов...
            </Button>
          </div>
        </div>

        {loading && <p className={styles.loading}>Загрузка...</p>}
        {error && <p className={styles.error}>{error}</p>}
        {!loading && !error && runs.length === 0 && (
          <p className={styles.empty}>Прогонов пока не было.</p>
        )}
        {!loading && !error && runs.map(run => <RunRow key={run.id} run={run} />)}
      </div>

      <AuthorPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        authors={confirmedAuthors}
        onConfirm={handleTrigger}
      />
    </div>
  );
}
