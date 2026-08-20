import React from 'react';
import logo from '../../assets/paywall/subscription-logo.svg';
import './SubscriptionButton.css';

interface SubscriptionButtonProps {
  // Есть ли платный доступ — от этого зависит только цвет бейджа PRO
  // (оранжевый / серый) и то, какую шторку откроет onClick у вызывающего.
  isActive: boolean;
  onClick: () => void;
}

// Кнопка в строке поиска, которой пользователь сам вызывает шторку оплаты
// или продления (Figma 1073:5550 — активная подписка, 997:4769 —
// неактивная). Обе версии — один и тот же ассет логотипа, отличается
// только бейдж; в Figma это два разных экспорта, но файлы побайтово
// совпадают, кроме внутреннего id clip-path, поэтому храним один.
export const SubscriptionButton: React.FC<SubscriptionButtonProps> = ({ isActive, onClick }) => (
  <button
    type="button"
    className="subscription-btn"
    onClick={onClick}
    aria-label={isActive ? 'Управление подпиской' : 'Оформить подписку'}
  >
    <img src={logo} alt="" className="subscription-btn-logo" />
    <span className={`subscription-btn-badge ${isActive ? 'active' : ''}`}>PRO</span>
  </button>
);
