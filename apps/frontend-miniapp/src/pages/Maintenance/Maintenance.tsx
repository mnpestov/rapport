import React from 'react';
import logo from '../../assets/logo.svg';
import './Maintenance.css';

export const Maintenance: React.FC = () => {
  return (
    <div className="maintenance-container">
      <div className="maintenance-content">
        <img src={logo} alt="Rapport" className="maintenance-logo" />
        <h1 className="maintenance-title">Технические работы</h1>
        <p className="maintenance-text">
          Мы временно приостановили работу приложения для технического обслуживания.
        </p>
        <p className="maintenance-text">
          Приносим извинения за неудобства — скоро всё заработает в штатном режиме.
        </p>
      </div>
    </div>
  );
};
