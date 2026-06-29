import React from 'react';
import logo from '../../assets/logo.svg';
import './TelegramOnly.css';

export const TelegramOnly: React.FC = () => {
  return (
    <div className="telegram-only-container">
      <div className="telegram-only-content">
        <img src={logo} alt="Rapport" className="telegram-only-logo" />
        <h1 className="telegram-only-title">Только в Telegram</h1>
        <p className="telegram-only-text">
          Раппорт — это Telegram Mini App. Он работает только внутри Telegram — откройте приложение через Telegram, чтобы продолжить.
        </p>
        <a
          className="telegram-only-button"
          href="https://t.me/rapportapp_bot/rapport"
        >
          Открыть в Telegram
        </a>
      </div>
    </div>
  );
};
