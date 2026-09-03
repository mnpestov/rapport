import { useEffect } from 'react';
import './Toast.css';

// Простой toast без библиотеки (в проекте её нет). Показывается снизу по
// центру, сам исчезает через duration. Управляется извне: рендерить, когда
// есть message, и сбрасывать message в onClose.

interface ToastProps {
  message: string | null;
  onClose: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({ message, onClose, duration = 3000 }) => {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  if (!message) return null;

  return <div className="app-toast" role="status">{message}</div>;
};
