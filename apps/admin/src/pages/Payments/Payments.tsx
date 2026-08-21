import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Loader2, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import {
  getPayments,
  checkPaymentStatus,
  AdminPayment,
  PaymentStatus,
  PaywallSource,
} from "../../api/payments";
import styles from "./Payments.module.css";

const LIMIT = 50;

const SOURCE_LABELS: Record<PaywallSource, string> = {
  AUTO_BANNER: "Автопоказ баннера",
  SEARCH_BUTTON: "Кнопка у поиска",
  EXPIRING_3_DAYS: "Напоминание за 3 дня",
  EXPIRING_1_DAY: "Напоминание за 1 день",
  ACTIVE: "Шторка активной подписки",
};

const STATUS_FILTERS: { value: PaymentStatus | ""; label: string }[] = [
  { value: "", label: "Все" },
  { value: "PAID", label: "Оплаченные" },
  { value: "PENDING", label: "Не оплаченные" },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  );
}

function userLabel(u: AdminPayment["user"]): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return name || u.username || u.telegramId;
}

export function Payments() {
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [total, setTotal] = useState(0);
  const [paidSum, setPaidSum] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [offset, setOffset] = useState(0);
  // Какой именно счёт сейчас проверяется — чтобы крутить спиннер на одной
  // строке, а не блокировать всю таблицу.
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getPayments({ search, status, limit: LIMIT, offset });
      setPayments(data.payments);
      setTotal(data.total);
      setPaidSum(data.paidSum);
    } catch {
      toast.error("Не удалось загрузить счета");
    } finally {
      setLoading(false);
    }
  }, [search, status, offset]);

  // Поиск с задержкой — как в остальных списках админки, чтобы не бить по
  // серверу на каждую букву.
  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const handleCheck = async (payment: AdminPayment) => {
    try {
      setCheckingId(payment.id);
      const result = await checkPaymentStatus(payment.id);

      if (!result.ok) {
        toast.error(result.message ?? "Не удалось проверить");
        return;
      }
      if (result.changed) {
        // Расхождение нашлось и исправлено — список обязан обновиться,
        // иначе строка так и будет показывать PENDING.
        toast.success(result.message ?? "Доступ выдан, счёт проведён");
        await load();
        return;
      }
      toast(`Счёт №${payment.invId}: ${result.stateLabel}${result.message ? `\n\n${result.message}` : ""}`, {
        duration: 6000,
      });
    } catch {
      toast.error("Ошибка при проверке");
    } finally {
      setCheckingId(null);
    }
  };

  const pageCount = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Счета"
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v);
            setOffset(0);
          },
          placeholder: "Номер счёта, имя, username, telegramId",
        }}
        totalCount={{ label: "счетов", value: total }}
      />

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || "all"}
              className={status === f.value ? styles.filterActive : styles.filter}
              onClick={() => {
                setStatus(f.value);
                setOffset(0);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className={styles.sum}>
          Оплачено на <strong>{paidSum.toLocaleString("ru-RU")} ₽</strong>
        </div>
      </div>

      {loading ? (
        <div className={styles.empty}>
          <Loader2 size={16} className={styles.spinner} /> Загрузка...
        </div>
      ) : payments.length === 0 ? (
        <div className={styles.empty}>Счетов не найдено</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№</th>
                <th>Пользователь</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Создан</th>
                <th>Оплачен</th>
                <th>Источник</th>
                <th>Чек</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className={styles.invId}>{p.invId}</td>
                  <td>
                    <div className={styles.userName}>{userLabel(p.user)}</div>
                    <div className={styles.userMeta}>
                      {p.user.username ? `@${p.user.username} · ` : ""}
                      {p.user.telegramId}
                    </div>
                  </td>
                  <td className={styles.amount}>{p.amount.toLocaleString("ru-RU")} ₽</td>
                  <td>
                    <span className={p.status === "PAID" ? styles.badgePaid : styles.badgePending}>
                      {p.status === "PAID" ? "Оплачен" : "Не оплачен"}
                    </span>
                  </td>
                  <td className={styles.date}>{formatDateTime(p.createdAt)}</td>
                  <td className={styles.date}>{formatDateTime(p.paidAt)}</td>
                  <td className={styles.source}>
                    {p.source ? SOURCE_LABELS[p.source] : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.date}>
                    {p.status !== "PAID" ? (
                      <span className={styles.muted}>—</span>
                    ) : p.receiptSentAt ? (
                      "Отправлен"
                    ) : (
                      <span className={styles.warn}>Не отправлен</span>
                    )}
                  </td>
                  <td>
                    <button
                      className={styles.checkBtn}
                      onClick={() => handleCheck(p)}
                      disabled={checkingId === p.id}
                      title="Спросить Robokassa о реальном состоянии счёта"
                    >
                      {checkingId === p.id ? (
                        <Loader2 size={14} className={styles.spinner} />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      Проверить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            Назад
          </button>
          <span className={styles.pageInfo}>
            {currentPage} из {pageCount}
          </span>
          <button
            className={styles.pageBtn}
            disabled={currentPage >= pageCount}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Вперёд
          </button>
        </div>
      )}

      <div className={styles.hint}>
        <ExternalLink size={13} />
        «Проверить» спрашивает Robokassa о реальном состоянии счёта. Если деньги получены,
        а у нас счёт числится неоплаченным — доступ выдаётся сразу же. Автоматически то же
        самое делает сверка каждые 15 минут.
      </div>
    </div>
  );
}
