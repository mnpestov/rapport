import React, { useEffect, useState } from "react";
import { getDashboardStats, DashboardResponse, TopPatternItem } from "../../api/dashboard";
import styles from "./Dashboard.module.css";

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
// Main Dashboard page
// ──────────────────────────────────────────────

export function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboardStats()
      .then(setData)
      .catch((err) => setError(err.message ?? "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

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
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>Статистика</h1>
      </div>

      <div className={styles.dateRow}>
        <span className={styles.dateLabel}>Сегодня: {today}</span>
      </div>

      {/* Stat cards grid */}
      <div className={styles.statsGrid}>
        <StatCard
          label="Всего пользователей"
          value={stats.totalUsers}
        />
        <StatCard
          label="Новых за неделю"
          value={stats.newUsersLast7Days}
        />
        <StatCard
          label="Переходов по ссылкам"
          value={stats.totalPatternLinkClicks}
        />
        <StatCard
          label="Просмотров карточек"
          value={stats.totalPatternViews}
        />
        <StatCard
          label="Переходов на подписку"
          value={stats.totalSubscribeClicks}
        />
        <StatCard
          label="Добавлений в избранное"
          value={stats.totalFavorites}
        />
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
