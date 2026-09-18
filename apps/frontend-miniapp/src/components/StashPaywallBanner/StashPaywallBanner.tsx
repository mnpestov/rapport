import React from 'react';
import { Lock } from 'lucide-react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import '../../styles/sheet.css';
import './StashPaywallBanner.css';

// Обновлённая модель платного доступа к хранилищу пряжи (Figma
// node-id=1358:21355): хранилище бесплатно всем до лимита артикулов,
// PREMIUM_YARN_STASH снимает лимит и открывает подбор описаний. Только
// UI-заглушка — реальной оплаты нет, выдача PREMIUM_YARN_STASH остаётся
// только через админку (по решению пользователя).
export type StashPaywallReason = 'limit' | 'matches';

interface StashPaywallBannerProps {
  isOpen: boolean;
  reason: StashPaywallReason;
  freeLimit: number;
  onClose: () => void;
}

const TEXT: Record<StashPaywallReason, { title: string; body: string }> = {
  limit: {
    title: '{limit} из {limit} бесплатных артикулов уже добавлены.',
    body: 'Откройте безлимитный доступ и продолжайте пополнять каталог без ограничений',
  },
  matches: {
    title: 'Подбор описаний — платная функция',
    body: 'Откройте безлимитный доступ, чтобы видеть, что можно связать из своей пряжи',
  },
};

export const StashPaywallBanner: React.FC<StashPaywallBannerProps> = ({ isOpen, reason, freeLimit, onClose }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  if (!isMounted) return null;

  const { title, body } = TEXT[reason];

  return (
    <div ref={sheetRef} className={`stash-paywall-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="stash-paywall-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="stash-paywall-lock">
          <Lock size={40} strokeWidth={1.5} />
        </div>
        <p className="stash-paywall-title">{title.replace(/\{limit\}/g, String(freeLimit))}</p>
        <p className="stash-paywall-body">{body}</p>
        <button type="button" className="btn stash-paywall-cta" disabled>
          Снять лимит
          <span className="stash-paywall-price">69 ₽/мес.</span>
        </button>
        <button type="button" className="btn stash-paywall-close" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
};
