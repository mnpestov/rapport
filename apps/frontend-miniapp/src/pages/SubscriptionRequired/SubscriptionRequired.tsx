import React, { useEffect, useState } from 'react';
import { fetchChannelInfo, ChannelInfo } from '../../api/channelApi';
import { trackSubscribeClick } from '../../api/analyticsApi';
import avatarPlaceholder from '../../assets/avatar.png';
import './SubscriptionRequired.css';

interface Props {
  channelInfo: ChannelInfo | null;
}

export const SubscriptionRequired: React.FC<Props> = ({ channelInfo: channel }) => {
  const [showToast, setShowToast] = useState(false);

  const handleSubscribe = () => {
    trackSubscribeClick();
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink("https://t.me/fashionhurma");
      setTimeout(() => tg.close(), 300);
    } else {
      window.open("https://t.me/fashionhurma", "_blank");
    }
  };

  const handleSupportBot = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink("https://t.me/rapportapp_bot?start=support");
      setTimeout(() => tg.close(), 300);
    } else {
      window.open("https://t.me/rapportapp_bot?start=support", "_blank");
    }
  };

  const handleCheck = () => {
    window.dispatchEvent(new CustomEvent("auth:recheck"));
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 3000);
  };

  return (
    <div className="subscription-container">
      <div className="subscription-header-text">
        Приложение доступно только для подписчиков ТГ канала «Фешн хурма»
      </div>

      {channel ? (
        <div className="subscription-channel-info">
          <div className="subscription-avatar-wrapper">
            <img 
              src={channel.photoUrl || avatarPlaceholder} 
              alt="Аватар канала" 
              className="subscription-avatar" 
            />
          </div>
          <div className="subscription-channel-title">
            {channel.title || "Фешн хурма"}
          </div>
          <div className="subscription-channel-subscribers">
            {channel.subscriberCount ? `${channel.subscriberCount.toLocaleString()} подписчиков` : ""}
          </div>
          {channel.description && (
            <div className="subscription-channel-desc">
              {channel.description}
            </div>
          )}
        </div>
      ) : (
        <div className="subscription-channel-skeleton">Загрузка информации о канале...</div>
      )}

      <div className="subscription-actions">
        <button className="subscription-btn-subscribe" onClick={handleSubscribe}>
          Подписаться
        </button>
        <button className="subscription-btn-check" onClick={handleCheck}>
          Проверить подписку
        </button>
      </div>

      {showToast && (
        <div className="subscription-toast">
          Проверка подписки...
        </div>
      )}
      <button className="subscription-link-support" onClick={handleSupportBot}>
        Я подписан, но не могу войти в приложение
      </button>
    </div>
  );
};
