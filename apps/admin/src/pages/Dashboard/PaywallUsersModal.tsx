import { useEffect, useState } from "react";
import { Button } from '../../components/Button/Button';
import { Loader2 } from "lucide-react";
import { Modal } from "../../components/Modal/Modal";
import {
  getPaywallStatsUsers,
  getPatternPriceAlertSubscribers,
  PaywallStatsUser,
  PaywallMetric,
  PaywallScope,
  Period,
} from "../../api/dashboard";
import styles from "./PaywallUsersModal.module.css";

const PAGE = 50;

// Либо метрика воронки (period/scope применяются), либо конкретное описание
// (список подписчиков на цену этого паттерна — без периода, там и так все).
export type DrilldownTarget =
  | { kind?: "metric"; metric: PaywallMetric; scope: PaywallScope; title: string }
  | { kind: "priceAlertPattern"; patternId: string; title: string };

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
  // Только для ACTIVE_SUBSCRIBERS — клик по заголовку "Срок действия"
  // переключает направление. Для остальных метрик заголовок не кликабелен,
  // сортировка не применяется (bэкенд игнорирует sortOrder для них).
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Сброс постранички при смене цели — иначе, открыв вторую метрику после
  // пролистывания первой, попадёшь сразу на её третью страницу.
  useEffect(() => {
    setOffset(0);
    setSortOrder("desc");
  }, [target && "metric" in target ? target.metric : undefined, target && "scope" in target ? target.scope : undefined, target && "patternId" in target ? target.patternId : undefined]);

  useEffect(() => {
    if (!target) return;
    let isMounted = true;
    setLoading(true);

    const request =
      target.kind === "priceAlertPattern"
        ? getPatternPriceAlertSubscribers(target.patternId)
        : (() => {
            const periodParams =
              period === "custom" && appliedRange
                ? { from: appliedRange.from, to: appliedRange.to }
                : { period: period as Exclude<Period, "custom"> };
            return getPaywallStatsUsers({ ...periodParams, metric: target.metric, scope: target.scope, limit: PAGE, offset, sortOrder });
          })();

    request
      .then((res) => {
        if (!isMounted) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => console.error("Не удалось загрузить детализацию:", err))
      .finally(() => { if (isMounted) setLoading(false); });

    return () => { isMounted = false; };
  }, [target, period, appliedRange, offset, sortOrder]);

  // Подписчики на цену не постранично (их не так много) — пагинация ниже
  // скрыта для них через pageCount.
  const isPriceAlertPattern = target?.kind === "priceAlertPattern";
  const isPaid = !isPriceAlertPattern && target?.metric === "PAID";
  // ELIGIBLE_FOR_RENEWAL_BANNER — та же форма ответа, что ACTIVE_SUBSCRIBERS
  // (User по premiumExpiresAt, count всегда 1, lastAt = дата истечения) —
  // общая колонка "Срок действия" с сортировкой подходит без изменений.
  const isActiveSubscribers =
    !isPriceAlertPattern &&
    (target?.metric === "ACTIVE_SUBSCRIBERS" || target?.metric === "ELIGIBLE_FOR_RENEWAL_BANNER");
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
                {isPaid ? <th>Счёт</th> : !isPriceAlertPattern && !isActiveSubscribers && <th>Раз</th>}
                {isActiveSubscribers ? (
                  <th
                    className={styles.sortable}
                    onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
                  >
                    Срок действия {sortOrder === "desc" ? "↓" : "↑"}
                  </th>
                ) : (
                  <th>{isPaid ? "Оплачен" : isPriceAlertPattern ? "Подписан" : "Последний раз"}</th>
                )}
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
                  {isPaid ? (
                    <td className={styles.center}>
                      №{u.invId}
                      <div className={styles.tgId}>{u.amount} ₽</div>
                    </td>
                  ) : !isPriceAlertPattern && !isActiveSubscribers && (
                    <td className={styles.center}>{u.count}</td>
                  )}
                  <td className={styles.meta}>{formatDateTime(u.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isPriceAlertPattern && pageCount > 1 && (
        <div className={styles.pagination}>
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
          >
            Назад
          </Button>
          <span className={styles.pageInfo}>{currentPage} из {pageCount}</span>
          <Button
            variant="secondary"
            disabled={currentPage >= pageCount}
            onClick={() => setOffset(offset + PAGE)}
          >
            Вперёд
          </Button>
        </div>
      )}
    </Modal>
  );
}
