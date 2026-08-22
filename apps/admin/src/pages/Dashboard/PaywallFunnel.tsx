import { PaywallStatsResponse, PaywallFunnelStep, PaywallMetric, PaywallScope } from "../../api/dashboard";
import { DrilldownTarget } from "./PaywallUsersModal";
import styles from "./PaywallFunnel.module.css";

interface Props {
  stats: PaywallStatsResponse;
  // Клик по любой цифре открывает список тех, кто за ней стоит. Сам список
  // живёт в PaywallUsersModal у родителя — виджет только сообщает, что
  // именно открыть.
  onDrilldown: (target: DrilldownTarget) => void;
}

// Доля от ВЕРХА воронки, а не от предыдущего шага: так видно сквозную
// конверсию "из показа в оплату", ради которой воронка и строится.
function share(value: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((value / total) * 1000) / 10}%`;
}

function Funnel({
  title,
  hint,
  step,
  scope,
  onDrilldown,
}: {
  title: string;
  hint: string;
  step: PaywallFunnelStep;
  scope: PaywallScope;
  onDrilldown: (target: DrilldownTarget) => void;
}) {
  const rows: { label: string; value: number; metric: PaywallMetric }[] = [
    { label: "Увидели баннер", value: step.shown, metric: "SHOWN" },
    { label: "Нажали «Оформить»", value: step.subscribeClick, metric: "SUBSCRIBE_CLICK" },
    { label: "Оплатили", value: step.paid, metric: "PAID" },
  ];

  return (
    <div className={styles.funnel}>
      <div className={styles.funnelTitle}>{title}</div>
      <div className={styles.funnelHint}>{hint}</div>
      <div className={styles.steps}>
        {rows.map((row, i) => (
          <button
            type="button"
            key={row.label}
            className={styles.step}
            onClick={() => onDrilldown({ metric: row.metric, scope, title: `${title}: ${row.label.toLowerCase()}` })}
            disabled={row.value === 0}
            title={row.value === 0 ? "Нет данных" : "Показать пользователей"}
          >
            <div className={styles.stepHeader}>
              <span className={styles.stepLabel}>{row.label}</span>
              <span className={styles.stepValue}>{row.value}</span>
            </div>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                // Ширина от верха воронки — полоски визуально сужаются,
                // как и положено воронке. При нулевом верхе рисуем пусто,
                // а не делим на ноль.
                style={{ width: step.shown === 0 ? "0%" : `${(row.value / step.shown) * 100}%` }}
              />
            </div>
            {i > 0 && <div className={styles.stepShare}>{share(row.value, step.shown)} от увидевших</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PaywallFunnel({ stats, onDrilldown }: Props) {
  const { events, acquisition, retention, paidWithoutSource } = stats;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>Подписка: воронка и события</span>
        {/* Считаются уникальные пользователи, а не события: один человек
            видит баннер ~4 раза в месяц, и по событиям конверсия была бы
            занижена в разы. */}
        <span className={styles.subtitle}>Уникальные пользователи за выбранный период</span>
      </div>

      <div className={styles.funnels}>
        <Funnel
          title="Привлечение"
          hint="Автопоказ баннера, кнопка у поиска и замки в фильтрах"
          step={acquisition}
          scope="acquisition"
          onDrilldown={onDrilldown}
        />
        <Funnel
          title="Удержание"
          hint="Продление: предупреждения об окончании и шторка активной подписки"
          step={retention}
          scope="retention"
          onDrilldown={onDrilldown}
        />
      </div>

      <div className={styles.eventsGrid}>
        {([
          { metric: "SHOWN", value: events.shown, label: "Показов баннера" },
          { metric: "SCROLLED_TO_END", value: events.scrolledToEnd, label: "Долистали до конца" },
          { metric: "SUBSCRIBE_CLICK", value: events.subscribeClick, label: "Клик «Оформить»" },
          { metric: "CLOSED", value: events.closed, label: "Закрыли баннер" },
          // Две последние плашки — единственные со своим scope: BUTTON_OPENED
          // приходит и от кнопки у поиска, и от замков в фильтрах, а подпись
          // у каждой только про своё. Остальные метрики источником не
          // разделяются. Ключ плашки поэтому не metric — он бы совпал.
          { key: "BUTTON_OPENED_SEARCH", metric: "BUTTON_OPENED", value: events.buttonOpened, label: "Открыли кнопкой у поиска", scope: "search_button" },
          { key: "BUTTON_OPENED_FILTERS", metric: "BUTTON_OPENED", value: events.buttonOpenedFromFilters, label: "Открыли из фильтров", scope: "filter_lock" },
        ] as { key?: string; metric: PaywallMetric; value: number; label: string; scope?: PaywallScope }[]).map((c) => (
          <button
            type="button"
            key={c.key ?? c.metric}
            className={styles.eventCard}
            onClick={() => onDrilldown({ metric: c.metric, scope: c.scope ?? "all", title: c.label })}
            disabled={c.value === 0}
            title={c.value === 0 ? "Нет данных" : "Показать пользователей"}
          >
            <div className={styles.eventValue}>{c.value}</div>
            <div className={styles.eventLabel}>{c.label}</div>
          </button>
        ))}
      </div>

      {paidWithoutSource > 0 && (
        <div className={styles.note}>
          Ещё {paidWithoutSource} оплат без источника — созданы до появления атрибуции,
          задним числом источник не восстановить.
        </div>
      )}
    </div>
  );
}
