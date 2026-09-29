import React, { useEffect, useRef, useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from './Calendar';
import './Calendar.css';

interface DateInputFieldProps {
  label: string;
  value: string; // yyyy-mm-dd, как отдаёт/принимает <input type="date">, или ''
  onChange: (value: string) => void;
  disabled?: boolean;
  align?: 'start' | 'end';
}

// Figma node-id=1360:23251/1454:15652 (поле) и 1360:26408 (сам календарь)
// — незаполненная дата показывается как "__.__.____", по клику
// раскрывается кастомный dropdown-календарь вместо системного
// <input type="date"> picker'а (тот выглядит по-разному в каждом
// браузере/ОС, макет требует единого вида).
export const DateInputField: React.FC<DateInputFieldProps> = ({ label, value, onChange, disabled, align = 'start' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const displayValue = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU')
    : '__.__.____';

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className={`add-project-date-field${align === 'end' ? ' add-project-date-field--end' : ''}`}>
      <label className="add-project-date-label">{label}</label>
      <div
        className={`add-project-date-value${disabled ? ' add-project-date-value--disabled' : ''}`}
        onClick={() => { if (!disabled) setIsOpen((v) => !v); }}
      >
        <span className={value ? '' : 'add-project-date-placeholder'}>{displayValue}</span>
        <span className="projects-status-icon-wrap">
          <CalendarIcon size={13} strokeWidth={1.5} />
        </span>
      </div>
      {isOpen && !disabled && (
        <Calendar value={value} onSelect={handleSelect} align={align} />
      )}
    </div>
  );
};
