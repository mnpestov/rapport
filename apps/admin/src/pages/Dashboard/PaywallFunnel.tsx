import { PaywallStatsResponse, RetentionFunnelStep, PaywallMetric, PaywallScope } from "../../api/dashboard";
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

interface FunnelRow {
  label: string;
  value: number;
  // metric отсутствует → строка не кликабельна (пока такой не бывает —
  // все строки воронки сейчас имеют drilldown).
  metric?: PaywallMetric;
  // Подпись под процентом ("от увидевших"/"от подписчиков") — у первого
  // шага (i===0) процента нет, он и есть база расчёта для остальных.
  shareOfLabel?: string;
  // Переопределяет scope воронки для конкретной строки — нужно "Показали
  // баннер продления" в retention: цифра там уже без ручных открытий
  // (source=ACTIVE), drilldown должен вести тех же людей.
  scope?: PaywallScope;
  // Переопределяет базу расчёта % и ширины полоски для ЭТОЙ строки —
  // по умолчанию (undefined) база одна на всю воронку (верхний шаг, rows[0]).
  // Нужно retention: "Платные подписчики" — знаменатель для % продлений,
  // но "Нажали «Оформить»"/"Оплатили" — конверсия от того, кому реально
  // показали баннер (rows[1]), а не от общего числа подписчиков.
  shareBase?: number;
}

// Удержание — воронка "% продлений": верх — платные подписчики за период
// (знаменатель метрики "% продлений" в заголовке), но конверсия по шагам
// ниже баннера считается от самого баннера (кому его реально показали), не
// от подписчиков — иначе шаги, не относящиеся к показу баннера напрямую
// (E.g. кто-то оформил из другого места), искажали бы % относительно того,
// что человек увидел.
function retentionRows(retention: RetentionFunnelStep): FunnelRow[] {
  const eligible = retention.eligibleForBanner;
  const shown = retention.shown;
  return [
    { label: "Платные подписчики", value: retention.activeSubscribers, metric: "ACTIVE_SUBSCRIBERS" },
    // Кому баннер ДОЛЖЕН показаться прямо сейчас (≤3 дня до истечения) —
    // часть этих людей не заходит в Раппорт в этом окне и никогда не
    // попадает в PaywallEvent(SHOWN) ниже, поэтому "Показали баннер" в
    // реальности недосчитывает охват. Мгновенный снимок, не зависит от
    // выбранного периода на дашборде (в отличие от остальных строк).
    { label: "Подходит срок продления", value: eligible, metric: "ELIGIBLE_FOR_RENEWAL_BANNER", shareOfLabel: "от подписчиков" },
    // Только автопоказ (EXPIRING_3_DAYS/EXPIRING_1_DAY) — ручное открытие
    // подписчиком через кнопку у поиска (source=ACTIVE) в эту цифру не
    // входит, хотя оно тоже "источник удержания" и учитывается в шагах ниже.
    // База % — строка выше ("Подходит срок"), а не "Платные подписчики":
    // так видно долю ОХВАТА среди тех, кому баннер вообще актуален.
    { label: "Показали баннер продления", value: shown, metric: "SHOWN", shareOfLabel: "от подходящих по сроку", shareBase: eligible, scope: "retention_auto_shown" },
    { label: "Нажали «Оформить»", value: retention.subscribeClick, metric: "SUBSCRIBE_CLICK", shareOfLabel: "от увидевших баннер", shareBase: shown },
    { label: "Оплатили", value: retention.paid, metric: "PAID", shareOfLabel: "от увидевших баннер", shareBase: shown },
  ];
}

function Funnel({
  title,
  hint,
  rows,
  scope,
  onDrilldown,
}: {
  title: string;
  hint: string;
  rows: FunnelRow[];
  scope: PaywallScope;
  onDrilldown: (target: DrilldownTarget) => void;
}) {
  const top = rows[0]?.value ?? 0;

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
            onClick={() => {
              if (!row.metric) return;
              onDrilldown({ metric: row.metric, scope: row.scope ?? scope, title: `${title}: ${row.label.toLowerCase()}` });
            }}
            disabled={row.value === 0 || !row.metric}
            title={!row.metric ? undefined : row.value === 0 ? "Нет данных" : "Показать пользователей"}
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
                style={{ width: top === 0 ? "0%" : `${(row.value / top) * 100}%` }}
              />
            </div>
            {i > 0 && <div className={styles.stepShare}>{share(row.value, row.shareBase ?? top)} {row.shareOfLabel}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PaywallFunnel({ stats, onDrilldown }: Props) {
  const { events, acquisition, retention, summary, paidWithoutSource } = stats;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.title}>Подписка: воронка и события</span>
          {/* Считаются уникальные пользователи, а не события: один человек
              видит баннер ~4 раза в месяц, и по событиям конверсия была бы
              занижена в разы. */}
          <span className={styles.subtitle}>Уникальные пользователи за выбранный период</span>
        </div>
        {/* Статус, а не воронка — "сколько платят сейчас" не зависит от
            периода (activeSubscribers смотрит только на снизу диапазона,
            см. countActiveSubscribers), "отказались" — сколько за период
            истекло без продления. Оба кликабельны — тот же drilldown, что
            у шагов воронки. */}
        <div className={styles.headerSummary}>
          <button
            type="button"
            className={styles.summaryStat}
            onClick={() => onDrilldown({ metric: "CURRENTLY_ACTIVE_SUBSCRIBERS", scope: "all", title: "Всего действующих платных подписчиков" })}
            disabled={summary.activeSubscribers === 0}
          >
            <span className={styles.summaryValue}>{summary.activeSubscribers}</span>
            <span className={styles.summaryLabel}>Действующих подписчиков</span>
          </button>
          <button
            type="button"
            className={styles.summaryStat}
            onClick={() => onDrilldown({ metric: "CHURNED_SUBSCRIBERS", scope: "all", title: "Отказались от продления" })}
            disabled={summary.churnedSubscribers === 0}
          >
            <span className={styles.summaryValue}>{summary.churnedSubscribers}</span>
            <span className={styles.summaryLabel}>Отказались</span>
          </button>
        </div>
      </div>

      <div className={styles.funnels}>
        <Funnel
          title="Привлечение"
          hint="Автопоказ баннера, кнопка у поиска и замки в фильтрах"
          rows={[
            { label: "Увидели баннер", value: acquisition.shown, metric: "SHOWN" },
            { label: "Нажали «Оформить»", value: acquisition.subscribeClick, metric: "SUBSCRIBE_CLICK", shareOfLabel: "от увидевших" },
            { label: "Оплатили", value: acquisition.paid, metric: "PAID", shareOfLabel: "от увидевших" },
          ]}
          scope="acquisition"
          onDrilldown={onDrilldown}
        />
        {/* % продлений: верх воронки — не показы баннера, а платные
            подписчики за период, дальше баннер продления → «Оформить» →
            оплата. Проценты остальных шагов считаются от подписчиков —
            это и есть доля продливших подписку. */}
        <Funnel
          title="Удержание"
          hint="% продлений: платные подписчики → баннер продления → «Оформить» → оплата"
          rows={retentionRows(retention)}
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
