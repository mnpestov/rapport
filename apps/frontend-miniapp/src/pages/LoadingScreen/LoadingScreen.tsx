import React from 'react';
import './LoadingScreen.css';

export const LoadingScreen: React.FC = () => {
  return (
    <div className="loading-container">
      <div className="loading-logo-wrapper">
        <h1 className="loading-logo">раппорт</h1>
        <p className="loading-subtitle">твой уникальный стиль</p>
      </div>
      <div className="spinner"></div>
    </div>
  );
};
