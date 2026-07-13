import React, { useEffect, useState } from "react";
import { getDashboardStats, DashboardResponse, TopPatternItem, Period } from "../../api/dashboard";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { DateRangePicker, DateRange } from "../../components/DateRangePicker/DateRangePicker";
import styles from "./Dashboard.module.css";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatRangeLabel(from: string, to: string): string {
  const fmt = (s: string) => {
    const [, m, d] = s.split("-");
    return `${parseInt(d)} ${["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][parseInt(m) - 1]}`;
  };
  return `${fmt(from)} — ${fmt(to)}`;
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  sub?: string;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{typeof value === "number" ? value.toLocaleString("ru-RU") : value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}

interface TopTableProps {
  title: string;
  icon: React.ReactNode;
  items: TopPatternItem[];
}

function TopTable({ title, icon, items }: TopTableProps) {
  return (
    <div className={styles.topCard}>
      <div className={styles.topCardHeader}>
        {icon}
        <span className={styles.topCardTitle}>{title}</span>
      </div>
      {items.length === 0 ? (
        <div className={styles.topEmpty}>Нет данных</div>
      ) : (
        <ol className={styles.topList}>
          {items.map((item, idx) => (
            <li key={item.patternId} className={styles.topItem}>
              <span className={styles.topIndex}>{idx + 1}.</span>
              <span className={styles.topName}>{item.title}</span>
              <span className={styles.topCount}>{item.count.toLocaleString("ru-RU")}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Period config
// ──────────────────────────────────────────────

const PERIODS: { value: Period; label: string; newUsersLabel: string; totalUsersLabel: string }[] = [
  { value: "7d", label: "7 дней", newUsersLabel: "Новых за 7 дней", totalUsersLabel: "Посетителей за 7 дней" },
  { value: "30d", label: "30 дней", newUsersLabel: "Новых за 30 дней", totalUsersLabel: "Посетителей за 30 дней" },
  { value: "90d", label: "90 дней", newUsersLabel: "Новых за 90 дней", totalUsersLabel: "Посетителей за 90 дней" },
  { value: "all", label: "Всё время", newUsersLabel: "Новых за неделю", totalUsersLabel: "Всего пользователей" },
  { value: "custom", label: "Свой период", newUsersLabel: "Новых за период", totalUsersLabel: "Посетителей за период" },
];

// ──────────────────────────────────────────────
// Main Dashboard page
// ──────────────────────────────────────────────

export function Dashboard() {
  const today = new Date();

  const [period, setPeriod] = useState<Period>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [appliedRange, setAppliedRange] = useState<DateRange | null>(null);

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (period === "custom" && !appliedRange) return;

    let isMounted = true;
    if (data) setIsRefreshing(true);
    else setLoading(true);

    const params = period === "custom" && appliedRange
      ? { from: appliedRange.from, to: appliedRange.to }
      : { period: period as Exclude<Period, "custom"> };

    getDashboardStats(params)
      .then((res) => { if (isMounted) { setData(res); setError(null); } })
      .catch((err) => { if (isMounted) setError(err.message ?? "Ошибка загрузки"); })
      .finally(() => { if (isMounted) { setLoading(false); setIsRefreshing(false); } });

    return () => { isMounted = false; };
  }, [period, appliedRange]);

  const handleTabClick = (p: Period) => {
    if (p === "custom") {
      setPickerOpen((open) => !open);
    } else {
      setPickerOpen(false);
      setPeriod(p);
    }
  };

  const handleRangeChange = (range: DateRange) => {
    setAppliedRange(range);
    setPeriod("custom");
    setPickerOpen(false);
  };

  const todayLabel = today.toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });

  const currentPeriod = PERIODS.find((p) => p.value === period)!;

  if (loading) {
    return (
      <div className={styles.container}>
        <h1 className={styles.pageTitle}>Статистика</h1>
        <div className={styles.centerState}>Загрузка...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.container}>
        <h1 className={styles.pageTitle}>Статистика</h1>
        <div className={styles.centerState} style={{ color: "#ef4444" }}>
          {error ?? "Не удалось загрузить данные"}
        </div>
      </div>
    );
  }

  const { stats, topByViews, topByLinkClicks, topByFavorites } = data;

  return (
    <div className={styles.container} style={{ opacity: isRefreshing ? 0.6 : 1, transition: "opacity 0.15s" }}>
      {/* Header */}
      <PageHeader title="Статистика" />

      {/* Controls row */}
      <div className={styles.controlsRow}>
        <span className={styles.dateLabel}>Сегодня: {todayLabel}</span>

        <div className={styles.rightControls}>
          <div className={styles.periodTabs}>
            {PERIODS.map((p) => {
              const isActive = period === p.value;
              const label = (p.value === "custom" && appliedRange)
                ? formatRangeLabel(appliedRange.from, appliedRange.to)
                : p.label;
              return (
                <button
                  key={p.value}
                  className={isActive ? styles.tabActive : styles.tab}
                  style={p.value === "custom" ? { minWidth: 137 } : undefined}
                  onClick={() => handleTabClick(p.value)}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {pickerOpen && (
            <DateRangePicker
              initialRange={appliedRange}
              onChange={handleRangeChange}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Stat cards grid */}
      <div className={styles.statsGrid}>
        <StatCard label={currentPeriod.totalUsersLabel} value={stats.totalUsers} />
        <StatCard label={currentPeriod.newUsersLabel} value={stats.newUsersInPeriod} />
        <StatCard label="Переходов по ссылкам" value={stats.totalPatternLinkClicks} />
        <StatCard label="Просмотров карточек" value={stats.totalPatternViews} />
        <StatCard label="Переходов на подписку" value={stats.totalSubscribeClicks} />
        <StatCard label="Добавлений в избранное" value={stats.totalFavorites} />
      </div>

      {/* Top tables */}
      <div className={styles.topGrid}>
        <TopTable
          title="Топ по просмотрам"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#83942C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          }
          items={topByViews}
        />
        <TopTable
          title="Топ по переходам к описанию"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#83942C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          }
          items={topByLinkClicks}
        />
        <TopTable
          title="Топ описаний в Избранном"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#83942C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          }
          items={topByFavorites}
        />
      </div>
    </div>
  );
}
