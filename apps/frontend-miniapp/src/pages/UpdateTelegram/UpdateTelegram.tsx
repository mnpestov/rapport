import React from 'react';
import logo from '../../assets/logo.svg';
import './UpdateTelegram.css';

export const UpdateTelegram: React.FC = () => {
  return (
    <div className="update-telegram-container">
      <div className="update-telegram-content">
        <img src={logo} alt="Rapport" className="update-telegram-logo" />
        <h1 className="update-telegram-title">Обновите Telegram</h1>
        <p className="update-telegram-text">
          Ваша версия Telegram устарела и не поддерживает Mini Apps. Пожалуйста, обновите приложение до актуальной версии.
        </p>
      </div>
    </div>
  );
};
