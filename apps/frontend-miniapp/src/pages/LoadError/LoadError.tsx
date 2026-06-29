import React from 'react';
import logo from '../../assets/logo.svg';
import './LoadError.css';

export const LoadError: React.FC = () => {
  return (
    <div className="load-error-container">
      <div className="load-error-content">
        <img src={logo} alt="Rapport" className="load-error-logo" />
        <h1 className="load-error-title">Ошибка загрузки</h1>
        <p className="load-error-text">
          Не удалось запустить приложение. Пожалуйста, закройте Mini App и попробуйте открыть снова.
        </p>
      </div>
    </div>
  );
};
