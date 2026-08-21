import { PaywallStatsResponse, PaywallFunnelStep } from "../../api/dashboard";
import styles from "./PaywallFunnel.module.css";

interface Props {
  stats: PaywallStatsResponse;
}

// Доля от ВЕРХА воронки, а не от предыдущего шага: так видно сквозную
// конверсию "из показа в оплату", ради которой воронка и строится.
function share(value: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((value / total) * 1000) / 10}%`;
}

function Funnel({ title, hint, step }: { title: string; hint: string; step: PaywallFunnelStep }) {
  const rows = [
    { label: "Увидели баннер", value: step.shown },
    { label: "Нажали «Оформить»", value: step.subscribeClick },
    { label: "Оплатили", value: step.paid },
  ];

  return (
    <div className={styles.funnel}>
      <div className={styles.funnelTitle}>{title}</div>
      <div className={styles.funnelHint}>{hint}</div>
      <div className={styles.steps}>
        {rows.map((row, i) => (
          <div key={row.label} className={styles.step}>
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
          </div>
        ))}
      </div>
    </div>
  );
}

export function PaywallFunnel({ stats }: Props) {
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
          hint="Автопоказ баннера и кнопка у поиска"
          step={acquisition}
        />
        <Funnel
          title="Удержание"
          hint="Продление: предупреждения об окончании и шторка активной подписки"
          step={retention}
        />
      </div>

      <div className={styles.eventsGrid}>
        <div className={styles.eventCard}>
          <div className={styles.eventValue}>{events.shown}</div>
          <div className={styles.eventLabel}>Показов баннера</div>
        </div>
        <div className={styles.eventCard}>
          <div className={styles.eventValue}>{events.scrolledToEnd}</div>
          <div className={styles.eventLabel}>Долистали до конца</div>
        </div>
        <div className={styles.eventCard}>
          <div className={styles.eventValue}>{events.subscribeClick}</div>
          <div className={styles.eventLabel}>Клик «Оформить»</div>
        </div>
        <div className={styles.eventCard}>
          <div className={styles.eventValue}>{events.closed}</div>
          <div className={styles.eventLabel}>Закрыли баннер</div>
        </div>
        <div className={styles.eventCard}>
          <div className={styles.eventValue}>{events.buttonOpened}</div>
          <div className={styles.eventLabel}>Открыли кнопкой у поиска</div>
        </div>
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
