import React from 'react';
import { CircleX } from 'lucide-react';
import './PaymentFail.css';

export const PaymentFail: React.FC = () => {
  return (
    <div className="payment-fail-container">
      <CircleX size={107} strokeWidth={0.75} color="#D8520F" />
      <div className="payment-fail-text-group">
        <h1 className="payment-fail-title">Оплата не прошла</h1>
        <p className="payment-fail-text">
          Средства не списаны. Вы можете попробовать оформить подписку ещё раз.
        </p>
      </div>
      <div className="payment-fail-button-wrapper">
        <a className="payment-fail-button" href="https://t.me/rapportapp_bot/rapport">
          Попробовать снова
        </a>
      </div>
      <p className="payment-fail-support">
        Если деньги всё же списались — <a href="https://t.me/rapportapp_bot">напишите нам.</a>
      </p>
    </div>
  );
};
