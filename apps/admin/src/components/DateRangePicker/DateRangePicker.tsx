import React, { useEffect, useRef, useState } from "react";
import { Button } from "../Button/Button";
import styles from "./DateRangePicker.module.css";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const DAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const todayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Monday-based day of week: 0=Mon, 6=Sun
function weekDay(year: number, month: number, day: number): number {
  return (new Date(year, month, day).getDay() + 6) % 7;
}

function buildGrid(year: number, month: number): (string | null)[] {
  const count = daysInMonth(year, month);
  const startPad = weekDay(year, month, 1);
  const grid: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) grid.push(null);
  for (let d = 1; d <= count; d++) {
    grid.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (grid.length % 7 !== 0) grid.push(null);
  return grid;
}

function addMonths(year: number, month: number, delta: number): [number, number] {
  let m = month + delta;
  let y = year;
  while (m > 11) { m -= 12; y++; }
  while (m < 0)  { m += 12; y--; }
  return [y, m];
}

function formatLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${parseInt(d)} ${["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"][parseInt(m) - 1]}`;
}

export interface DateRange {
  from: string;
  to: string;
}

interface Props {
  initialRange?: DateRange | null;
  onChange: (range: DateRange) => void;
  onClose: () => void;
}

export function DateRangePicker({ initialRange, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const today = todayStr();
  const now = new Date();

  // Left month is one before current
  const [leftYear, setLeftYear]   = useState(() => addMonths(now.getFullYear(), now.getMonth(), -1)[0]);
  const [leftMonth, setLeftMonth] = useState(() => addMonths(now.getFullYear(), now.getMonth(), -1)[1]);

  const [rightYear, rightMonth] = addMonths(leftYear, leftMonth, 1);

  const [startDate, setStartDate] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const [lY, lM] = [leftYear, leftMonth];
  const canPrev = true; // no lower bound
  const canNext = (() => {
    const [ny, nm] = addMonths(rightYear, rightMonth, 1);
    return ny < now.getFullYear() || (ny === now.getFullYear() && nm <= now.getMonth());
  })();

  const handlePrev = () => {
    const [y, m] = addMonths(lY, lM, -1);
    setLeftYear(y); setLeftMonth(m);
  };
  const handleNext = () => {
    if (!canNext) return;
    const [y, m] = addMonths(lY, lM, 1);
    setLeftYear(y); setLeftMonth(m);
  };

  // Compute the current visible range (from startDate + hover/end)
  const getRange = (): { from: string | null; to: string | null } => {
    if (!startDate) return { from: null, to: null };
    const end = hoverDate;
    if (!end) return { from: startDate, to: null };
    return startDate <= end
      ? { from: startDate, to: end }
      : { from: end,       to: startDate };
  };

  const { from: rf, to: rt } = getRange();

  const handleDayClick = (day: string) => {
    if (day > today) return;
    if (!startDate) {
      setStartDate(day);
    } else {
      const from = day < startDate ? day : startDate;
      const to   = day < startDate ? startDate : day;
      onChange({ from, to });
    }
  };

  const renderMonth = (year: number, month: number) => {
    const grid = buildGrid(year, month);
    return (
      <div className={styles.month}>
        <div className={styles.monthName}>{MONTHS_RU[month]} {year}</div>
        <div className={styles.weekdays}>
          {DAYS_RU.map((d) => <div key={d} className={styles.weekday}>{d}</div>)}
        </div>
        <div className={styles.grid}>
          {grid.map((day, i) => {
            if (!day) return <div key={i} className={styles.empty} />;

            const disabled = day > today;
            const isStart  = rf !== null && day === rf;
            const isEnd    = rt !== null && day === rt;
            const inRange  = rf !== null && rt !== null && day > rf && day < rt;
            const isToday  = day === today;
            const isSingle = isStart && (rt === null || day === rt);

            // Strip class: the horizontal background connecting the range
            let stripCls = styles.strip;
            if (!disabled) {
              if (isStart && !isSingle) stripCls += " " + styles.stripStart;
              else if (isEnd && !isSingle) stripCls += " " + styles.stripEnd;
              else if (inRange) stripCls += " " + styles.stripFull;
            }

            // Circle class: the day number bubble
            let circleCls = styles.circle;
            if (disabled)  circleCls += " " + styles.circleDisabled;
            else if (isStart || isEnd || isSingle) circleCls += " " + styles.circleSelected;
            else if (isToday) circleCls += " " + styles.circleToday;

            return (
              <div
                key={i}
                className={`${styles.dayCell}${disabled ? " " + styles.disabledCell : ""}`}
                onClick={() => handleDayClick(day)}
                onMouseEnter={() => !disabled && setHoverDate(day)}
                onMouseLeave={() => setHoverDate(null)}
              >
                <div className={stripCls} />
                <div className={circleCls}>
                  {parseInt(day.split("-")[2], 10)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.picker} ref={ref}>
      <div className={styles.nav}>
        <button className={styles.navBtn} onClick={handlePrev} disabled={!canPrev} aria-label="Предыдущий месяц">
          ‹
        </button>
        <div className={styles.months}>
          {renderMonth(leftYear, leftMonth)}
          {renderMonth(rightYear, rightMonth)}
        </div>
        <button className={styles.navBtn} onClick={handleNext} disabled={!canNext} aria-label="Следующий месяц">
          ›
        </button>
      </div>

      <div className={styles.footer}>
        {!startDate && (
          <span className={styles.hint}>Выберите начальную дату</span>
        )}
        {startDate && !hoverDate && (
          <span className={styles.hint}>
            {formatLabel(startDate)} — выберите конечную дату
          </span>
        )}
        {startDate && hoverDate && rf && rt && (
          <span className={styles.hint}>
            {formatLabel(rf)} — {formatLabel(rt)}
          </span>
        )}
        <Button variant="secondary" onClick={onClose}>Отмена</Button>
      </div>
    </div>
  );
}
