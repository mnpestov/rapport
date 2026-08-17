import React from 'react';
import { CircleCheck } from 'lucide-react';
import './PaymentSuccess.css';

export const PaymentSuccess: React.FC = () => {
  return (
    <div className="payment-success-container">
      <CircleCheck size={107} strokeWidth={0.75} color="#A9AE36" />
      <div className="payment-success-text-group">
        <h1 className="payment-success-title">Оплата прошла успешно</h1>
        <p className="payment-success-text">
          Подписка активна. Платные функции появятся в приложении в течение минуты. Чек придёт вам в Telegram-бот.
        </p>
      </div>
      <div className="payment-success-button-wrapper">
        <a className="payment-success-button" href="https://t.me/rapportapp_bot/rapport">
          Вернуться в приложение
        </a>
      </div>
      <p className="payment-success-support">
        Если доступ не появился в течение нескольких минут — <a href="https://t.me/rapportapp_bot">напишите нам.</a>
      </p>
    </div>
  );
};
