import React from 'react';
import logo from '../../assets/logo.svg';
import './PaymentFail.css';

export const PaymentFail: React.FC = () => {
  return (
    <div className="payment-fail-container">
      <div className="payment-fail-content">
        <img src={logo} alt="Rapport" className="payment-fail-logo" />
        <h1 className="payment-fail-title">Оплата не прошла</h1>
        <p className="payment-fail-text">
          Средства не списаны. Вы можете попробовать оформить подписку ещё раз.
        </p>
        <a
          className="payment-fail-button"
          href="https://t.me/rapportapp_bot/rapport"
        >
          Попробовать снова
        </a>
        <p className="payment-fail-support">
          Если деньги всё же списались — <a href="https://t.me/rapportapp_bot">напишите нам</a>.
        </p>
      </div>
    </div>
  );
};
