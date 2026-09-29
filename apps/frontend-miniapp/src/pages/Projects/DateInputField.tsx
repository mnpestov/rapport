import React, { useRef } from 'react';
import { Calendar } from 'lucide-react';

interface DateInputFieldProps {
  label: string;
  value: string; // yyyy-mm-dd, как отдаёт/принимает <input type="date">, или ''
  onChange: (value: string) => void;
  disabled?: boolean;
  align?: 'start' | 'end';
}

// Figma node-id=1360:23251/1454:15652 — незаполненная дата показывается как
// "__.__.____", не как placeholder браузерного <input type="date"> (тот
// рисует его сам, по-разному в разных браузерах, и не даёт задать текст
// напрямую). Показываем дд.мм.гггг/подчёркивания сами, а нативный date
// input держим поверх прозрачным — так остаётся системный date-picker UI
// по клику/тапу, без переизобретения календаря.
export const DateInputField: React.FC<DateInputFieldProps> = ({ label, value, onChange, disabled, align = 'start' }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU')
    : '__.__.____';

  const openPicker = () => {
    if (disabled) return;
    const input = inputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.focus();
  };

  return (
    <div className={`add-project-date-field${align === 'end' ? ' add-project-date-field--end' : ''}`}>
      <label className="add-project-date-label">{label}</label>
      <div className={`add-project-date-value${disabled ? ' add-project-date-value--disabled' : ''}`} onClick={openPicker}>
        <span className={value ? '' : 'add-project-date-placeholder'}>{displayValue}</span>
        <span className="projects-status-icon-wrap">
          <Calendar size={13} strokeWidth={1.5} />
        </span>
        <input
          ref={inputRef}
          type="date"
          className="add-project-date-input-hidden"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
};
