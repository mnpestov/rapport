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
          Раппорт — это Mini App. Он работает только внутри мессенджера — откройте приложение через Telegram, чтобы продолжить.
        </p>
        <a
          className="telegram-only-button"
          href="https://t.me/rapportapp_bot/rapport"
        >
          Открыть в Telegram
        </a>
        <div className="telegram-only-legal">
          <p className="telegram-only-legal-reqs">
            Самозанятый Пестова Юлия Юрьевна · ИНН 410116038191 · г. Москва
          </p>
          <p className="telegram-only-legal-links">
            <a href="/oferta">Публичная оферта</a>
            {' · '}
            <a href="/privacy">Политика обработки персональных данных</a>
          </p>
        </div>
      </div>
    </div>
  );
};
