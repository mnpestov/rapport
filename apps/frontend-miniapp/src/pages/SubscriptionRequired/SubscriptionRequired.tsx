import React from 'react';
import './SubscriptionRequired.css';

export const SubscriptionRequired: React.FC = () => {
  return (
    <div className="subscription-container">
      <div className="subscription-content">
        <h2>Доступ закрыт 🔒</h2>
        <p>Каталог описаний доступен только для подписчиков нашего закрытого Telegram-канала.</p>
        <button className="primary-button subscribe-btn">Подписаться на канал</button>
        <button className="secondary-button check-btn">Проверить подписку</button>
      </div>
    </div>
  );
};
