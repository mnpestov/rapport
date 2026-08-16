import React from 'react';
import logo from '../../assets/logo.svg';
import './PaymentSuccess.css';

export const PaymentSuccess: React.FC = () => {
  return (
    <div className="payment-success-container">
      <div className="payment-success-content">
        <img src={logo} alt="Rapport" className="payment-success-logo" />
        <h1 className="payment-success-title">Оплата прошла успешно</h1>
        <p className="payment-success-text">
          Подписка активна. Платные функции появятся в приложении в течение минуты. Чек придёт вам в Telegram-бот.
        </p>
        <a
          className="payment-success-button"
          href="https://t.me/rapportapp_bot/rapport"
        >
          Вернуться в приложение
        </a>
        <p className="payment-success-support">
          Если доступ не появился в течение нескольких минут — <a href="https://t.me/rapportapp_bot">напишите нам</a>.
        </p>
      </div>
    </div>
  );
};
