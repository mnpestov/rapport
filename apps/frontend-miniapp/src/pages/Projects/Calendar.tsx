import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarProps {
  // yyyy-mm-dd или '' — тот же формат, что DateInputField/<input type="date">.
  value: string;
  onSelect: (value: string) => void;
  // Сторона, к которой прижимается popover относительно поля-триггера —
  // 'end' используется для второго поля в паре ("Завершено" справа от
  // "Начало", см. AddProjectModal.css .add-project-dates-row), иначе
  // календарь вылезал бы за правый край панели формы.
  align?: 'start' | 'end';
}

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_LABELS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const toDateKey = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Сетка недель для месяца (year, month0) — 6 строк по 7 дней, с числами
// соседних месяцев по краям (Figma node-id=1360:26408: "27 28 29 30 31" в
// начале сетки июня — хвост мая, приглушённый opacity-60). Всегда ровно 6
// недель, даже если для конкретного месяца хватило бы 5 — так высота
// календаря не прыгает при навигации между месяцами.
function buildMonthGrid(year: number, month0: number): { key: string; day: number; inMonth: boolean }[][] {
  const firstOfMonth = new Date(year, month0, 1);
  // getDay(): 0=Вс..6=Сб — переводим в понедельник-первую неделю (0=Пн..6=Вс).
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month0, 0).getDate();

  const cells: { key: string; day: number; inMonth: boolean }[] = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const [y, m] = month0 === 0 ? [year - 1, 11] : [year, month0 - 1];
    cells.push({ key: toDateKey(y, m, day), day, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ key: toDateKey(year, month0, day), day, inMonth: true });
  }
  while (cells.length < 42) {
    const day = cells.length - firstWeekday - daysInMonth + 1;
    const [y, m] = month0 === 11 ? [year + 1, 0] : [year, month0 + 1];
    cells.push({ key: toDateKey(y, m, day), day, inMonth: false });
  }

  const weeks: { key: string; day: number; inMonth: boolean }[][] = [];
  for (let i = 0; i < 42; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Кастомный dropdown-календарь (Figma node-id=1360:26408) — заменяет
// системный <input type="date"> picker, единый вид на всех браузерах/
// устройствах. Чистая сетка месяца + навигация стрелками, без выбора
// месяца/года через отдельный picker (шеврон у заголовка в макете
// декоративный — при таком объёме месяцев в проекте отдельный
// month/year-picker избыточен, обычная навигация по одному покрывает
// сценарий "проект начат N месяцев назад").
export const Calendar: React.FC<CalendarProps> = ({ value, onSelect, align = 'start' }) => {
  const initial = value ? new Date(`${value}T00:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  const weeks = buildMonthGrid(viewYear, viewMonth);

  const goPrevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  };
  const goNextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  };

  return (
    <div className={`calendar-popover${align === 'end' ? ' calendar-popover--end' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="calendar-header">
        <p className="calendar-title">{MONTH_LABELS[viewMonth]} {viewYear}</p>
        <div className="calendar-nav">
          <button type="button" className="calendar-nav-btn" onClick={goPrevMonth} aria-label="Предыдущий месяц">
            <ChevronLeft size={16} strokeWidth={1.5} />
          </button>
          <button type="button" className="calendar-nav-btn" onClick={goNextMonth} aria-label="Следующий месяц">
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="calendar-weekdays">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={label} className={`calendar-weekday${i >= 5 ? ' calendar-weekday--weekend' : ''}`}>
            {label}
          </div>
        ))}
      </div>

      <div className="calendar-grid">
        {weeks.map((week) => (
          <div key={week[0].key} className="calendar-week">
            {week.map((cell, i) => {
              const isWeekend = i >= 5;
              const isSelected = value !== '' && cell.key === value;
              const classes = [
                'calendar-day',
                !cell.inMonth && 'calendar-day--outside',
                isWeekend && 'calendar-day--weekend',
                isSelected && 'calendar-day--selected',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={cell.key}
                  type="button"
                  className={classes}
                  onClick={() => onSelect(cell.key)}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
