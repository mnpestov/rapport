import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "../../components/Button/Button";
import { getUserActivitySegments, UserActivitySegmentsResponse } from "../../api/dashboard";
import styles from "./UserActivitySegments.module.css";

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function formatWeek(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`;
}

const SEGMENT_META: { key: keyof UserActivitySegmentsResponse["segments"]; label: string; hint: string; color: string }[] = [
  { key: "paid", label: "Платящие", hint: "активная подписка сейчас", color: "#1baf7a" },
  { key: "active", label: "Активные", hint: "смотрели каталог за 30 дней", color: "#2a78d6" },
  { key: "sleeping", label: "Спящие", hint: "последний просмотр 30–90 дней назад", color: "#eda100" },
  { key: "dead", label: "Мёртвые", hint: "ни одного просмотра карточки за всё время", color: "#e34948" },
  { key: "churned", label: "Отвалившиеся", hint: "последний просмотр 90+ дней назад", color: "#9b9a9a" },
];

/**
 * «Реальная» аудитория — в отличие от голого count(User) на вкладке
 * пользователей, который включает и тех, кто дошёл только до авторизации в
 * боте и ни разу не открыл каталог.
 *
 * Запрос дорогой (полный проход по PatternView) — считается только по
 * клику "Обновить", а не при каждом открытии страницы статистики.
 */
export function UserActivitySegments() {
  const [data, setData] = useState<UserActivitySegmentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    getUserActivitySegments()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  const total = data ? Object.values(data.segments).reduce((a, b) => a + b, 0) : 0;
  const maxWeekly = data ? Math.max(1, ...data.weekly.map((w) => Math.max(w.newUsers, w.activeUsers))) : 1;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <span className={styles.title}>Реальная аудитория</span>
          <span className={styles.subtitle}>
            Сегментация по факту просмотра каталога, не по голому числу аккаунтов
            {data && <> · обновлено {new Date(data.generatedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
          </span>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading} icon={loading ? <Loader2 size={16} className={styles.spin} /> : <RefreshCw size={16} />}>
          {data ? "Обновить" : "Посчитать"}
        </Button>
      </div>

      {error && <div className={styles.error}>Не удалось загрузить — попробуйте ещё раз.</div>}

      {!data && !loading && !error && (
        <div className={styles.empty}>Запрос дорогой (сканирует все просмотры) — считается только по кнопке.</div>
      )}

      {data && (
        <>
          <div className={styles.segmentGrid}>
            {SEGMENT_META.map((s) => {
              const count = data.segments[s.key];
              const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
              return (
                <div className={styles.segmentCell} key={s.key}>
                  <div className={styles.segmentHeader}>
                    <span className={styles.dot} style={{ background: s.color }} />
                    <span className={styles.segmentLabel}>{s.label}</span>
                  </div>
                  <div className={styles.segmentValue}>{count.toLocaleString("ru-RU")}</div>
                  <div className={styles.segmentPct}>{pct}% от {total.toLocaleString("ru-RU")}</div>
                  <div className={styles.segmentHint}>{s.hint}</div>
                </div>
              );
            })}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Регистрации vs реальная активность по неделям</div>
            <div className={styles.weeklyChart}>
              {data.weekly.map((w) => (
                <div className={styles.weeklyCol} key={w.week} title={`${formatWeek(w.week)}: ${w.newUsers} новых, ${w.activeUsers} активных`}>
                  <div className={styles.weeklyBars}>
                    <div className={styles.weeklyBarNew} style={{ height: `${(w.newUsers / maxWeekly) * 100}%` }} />
                    <div className={styles.weeklyBarActive} style={{ height: `${(w.activeUsers / maxWeekly) * 100}%` }} />
                  </div>
                  <div className={styles.weeklyLabel}>{formatWeek(w.week)}</div>
                </div>
              ))}
            </div>
            <div className={styles.legendRow}>
              <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#2a78d6" }} />Новых регистраций</span>
              <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#1baf7a" }} />Активных за неделю</span>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Удержание по когортам регистрации (D7+)</div>
            <table className={styles.cohortTable}>
              <thead>
                <tr><th>Неделя</th><th>Размер</th><th>Вернулись после 7д</th><th>D7+</th></tr>
              </thead>
              <tbody>
                {data.cohorts.slice(-10).map((c, i, arr) => {
                  const pct = c.cohortSize > 0 ? Math.round((c.returnedD7Plus / c.cohortSize) * 1000) / 10 : 0;
                  const immature = i >= arr.length - 2;
                  return (
                    <tr key={c.week}>
                      <td>{formatWeek(c.week)}{immature && <span className={styles.immature}> (рано судить)</span>}</td>
                      <td>{c.cohortSize.toLocaleString("ru-RU")}</td>
                      <td>{c.returnedD7Plus.toLocaleString("ru-RU")}</td>
                      <td className={styles.retentionCell}>
                        <span className={styles.retentionBar} style={{ width: `${Math.min(pct, 100)}%` }} />
                        <span className={styles.retentionText}>{pct}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
