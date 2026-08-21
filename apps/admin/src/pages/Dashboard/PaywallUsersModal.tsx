import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "../../components/Modal/Modal";
import {
  getPaywallStatsUsers,
  PaywallStatsUser,
  PaywallMetric,
  PaywallScope,
  Period,
} from "../../api/dashboard";
import styles from "./PaywallUsersModal.module.css";

const PAGE = 50;

export interface DrilldownTarget {
  metric: PaywallMetric;
  scope: PaywallScope;
  // Заголовок модалки — берётся с той плашки, по которой кликнули, чтобы
  // не собирать его заново из metric+scope и не разойтись с подписью.
  title: string;
}

interface Props {
  target: DrilldownTarget | null;
  period: Period;
  appliedRange: { from: string; to: string } | null;
  onClose: () => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  );
}

function userName(u: PaywallStatsUser): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || u.telegramId;
}

export function PaywallUsersModal({ target, period, appliedRange, onClose }: Props) {
  const [items, setItems] = useState<PaywallStatsUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  // Сброс постранички при смене метрики — иначе, открыв вторую метрику
  // после пролистывания первой, попадёшь сразу на её третью страницу.
  useEffect(() => {
    setOffset(0);
  }, [target?.metric, target?.scope]);

  useEffect(() => {
    if (!target) return;
    let isMounted = true;
    setLoading(true);

    const periodParams =
      period === "custom" && appliedRange
        ? { from: appliedRange.from, to: appliedRange.to }
        : { period: period as Exclude<Period, "custom"> };

    getPaywallStatsUsers({ ...periodParams, metric: target.metric, scope: target.scope, limit: PAGE, offset })
      .then((res) => {
        if (!isMounted) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => console.error("Не удалось загрузить детализацию:", err))
      .finally(() => { if (isMounted) setLoading(false); });

    return () => { isMounted = false; };
  }, [target, period, appliedRange, offset]);

  const isPaid = target?.metric === "PAID";
  const pageCount = Math.ceil(total / PAGE);
  const currentPage = Math.floor(offset / PAGE) + 1;

  return (
    <Modal isOpen={!!target} onClose={onClose} title={target?.title ?? ""} maxWidth={720}>
      <div className={styles.summary}>
        Всего пользователей: <strong>{total}</strong>
      </div>

      {loading ? (
        <div className={styles.empty}>
          <Loader2 size={16} className={styles.spinner} /> Загрузка...
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>Пусто</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Telegram</th>
                {isPaid ? <th>Счёт</th> : <th>Раз</th>}
                <th>{isPaid ? "Оплачен" : "Последний раз"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={`${u.userId}-${u.invId ?? ""}`}>
                  <td className={styles.name}>{userName(u)}</td>
                  <td className={styles.meta}>
                    {u.username ? `@${u.username}` : "—"}
                    <div className={styles.tgId}>{u.telegramId}</div>
                  </td>
                  <td className={styles.center}>
                    {isPaid ? (
                      <>
                        №{u.invId}
                        <div className={styles.tgId}>{u.amount} ₽</div>
                      </>
                    ) : (
                      u.count
                    )}
                  </td>
                  <td className={styles.meta}>{formatDateTime(u.lastAt)}</td>
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
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
          >
            Назад
          </button>
          <span className={styles.pageInfo}>{currentPage} из {pageCount}</span>
          <button
            className={styles.pageBtn}
            disabled={currentPage >= pageCount}
            onClick={() => setOffset(offset + PAGE)}
          >
            Вперёд
          </button>
        </div>
      )}
    </Modal>
  );
}
