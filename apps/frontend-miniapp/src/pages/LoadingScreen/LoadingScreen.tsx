import React from 'react';
import './LoadingScreen.css';
import logo from '../../assets/logo.svg';
import logo2 from '../../assets/logo2.svg';

export const LoadingScreen: React.FC = () => {
  return (
    <div className="loading-container">
      <div className="loading-content">
        <div className="loading-logo-wrapper">
          <img src={logo} alt="Logo" className="loading-logo" />
          <p className="loading-subtitle">Агрегатор описаний вязаных изделий</p>
        </div>

        <div className="loading-progress-wrapper">
          <div className="loading-progress-bar">
            <div className="loading-progress-fill"></div>
          </div>
          <p className="loading-progress-text">Приложение скоро загрузится</p>
        </div>
      </div>

      <div className="loading-footer-logos">
        <img src={logo2} alt="Decoration" />
        {/* <img src={logo2} alt="Decoration" /> */}
      </div>
    </div>
  );
};
