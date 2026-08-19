import React, { useState } from 'react';
import { submitPaywallImpression } from '../../api/paywallApi';
import { createPayment } from '../../api/paymentsApi';
import { openExternalLink } from '../../utils/telegram';
import logo from '../../assets/paywall/rapport-logo.svg';
import discountTag from '../../assets/paywall/advantage-discount-tag.png';
import priceVisibility from '../../assets/paywall/advantage-price-visibility.png';
import authorLink from '../../assets/paywall/advantage-author-link.png';
import priceSort from '../../assets/paywall/advantage-price-sort.png';
import similarPatterns from '../../assets/paywall/advantage-similar-patterns.png';
import multiPhoto from '../../assets/paywall/advantage-multi-photo.png';
import priceFilter from '../../assets/paywall/advantage-price-filter.png';
import favoritesFilters from '../../assets/paywall/advantage-favorites-filters.png';
import yarnThicknessFilter from '../../assets/paywall/advantage-yarn-thickness-filter.png';
import densityFilter from '../../assets/paywall/advantage-density-filter.png';
import './PaywallModal.css';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Advantage {
  image: string;
  title: string;
  text: string;
}

// Defense-in-depth: paymentUrl is fully server-built (never user input), so
// this isn't defending against a realistic attack today — but it's a cheap
// check against ever opening something other than Robokassa's own domain if
// that assumption changes later.
const ROBOKASSA_ORIGIN = 'https://auth.robokassa.ru';

// Copy + feature set from Figma node 970:12151 — matches PREMIUM_EXTRA 1:1
// (PAID_TIER_PERMISSIONS_PLAN.md §0), no discrepancy found when cross-checked.
const ADVANTAGES: Advantage[] = [
  { image: discountTag, title: 'Тег «Скидка»', text: 'Фильтруйте описания с акциями. Экономьте на том, что и так планировали купить.' },
  { image: priceVisibility, title: 'Видимость цены', text: 'Стоимость описания теперь сразу на карточке. Без лишних действий.' },
  { image: authorLink, title: 'Гиперссылка на автора', text: 'Переходите к другим работам мастера в один клик прямо со страницы описания.' },
  { image: priceSort, title: 'Сортировка по цене', text: 'Упорядочивайте модели — от дешёвых к дорогим или наоборот.' },
  { image: similarPatterns, title: 'Похожие модели', text: 'Рекомендации описаний со схожими характеристиками. Легко выбрать альтернативу.' },
  { image: multiPhoto, title: 'Множественность фото', text: '5 фотографий вместо одной. Рассмотрите модель со всех сторон.' },
  { image: priceFilter, title: 'Фильтр по цене', text: 'Отбирайте описания в нужном ценовом диапазоне.' },
  { image: favoritesFilters, title: 'Фильтры в Избранном', text: 'Находите нужное среди сохранёнок: по плотности, пряже, типу изделия.' },
  { image: yarnThicknessFilter, title: 'Фильтр по толщине пряжи', text: 'Подборка моделей под метраж вашей пряжи. Используйте то, что уже есть.' },
  { image: densityFilter, title: 'Фильтр по плотности', text: 'Находите описания, идеально подходящие под вашу плотность вязания. Никаких пересчётов.' },
];

export const PaywallModal: React.FC<PaywallModalProps> = ({ isOpen, onClose }) => {
  const [isCreatingPayment, setIsCreatingPayment] = useState(false);

  if (!isOpen) return null;

  // Click is tracked the same way the stub used to (separately from the
  // impression already recorded on open, App.tsx) — then a real Payment is
  // created and the user is sent to Robokassa via tg.openLink, not
  // openTelegramLink (that's for t.me deep links only, Robokassa's domain
  // isn't one — see PAYMENTS_ROBOKASSA_PLAN.md §3.5/§7 шаг 5). The modal is
  // left open on failure so the user can retry instead of losing the offer.
  const handleSubscribeClick = async () => {
    if (isCreatingPayment) return;
    submitPaywallImpression(true);
    setIsCreatingPayment(true);
    try {
      const paymentUrl = await createPayment();
      if (new URL(paymentUrl).origin !== ROBOKASSA_ORIGIN) {
        throw new Error(`Unexpected payment URL origin: ${paymentUrl}`);
      }
      openExternalLink(paymentUrl);
      onClose();
    } catch (error) {
      console.error('[Paywall] Failed to create payment:', error);
    } finally {
      setIsCreatingPayment(false);
    }
  };

  return (
    <div className="paywall-modal-overlay" onClick={onClose}>
      <div className="paywall-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="paywall-modal-scroll">
          <div className="paywall-modal-header">
            <h1 className="paywall-modal-title">Расширьте возможности</h1>
            <img src={logo} alt="Rapport" className="paywall-modal-logo" />
            <h1 className="paywall-modal-title">с Премиум-подпиской</h1>
          </div>

          <ul className="paywall-advantages-list">
            {ADVANTAGES.map((advantage) => (
              <li className="paywall-advantage" key={advantage.title}>
                <div className="paywall-advantage-image">
                  <img src={advantage.image} alt="" className="paywall-advantage-screenshot" />
                </div>
                <div className="paywall-advantage-text">
                  <p className="paywall-advantage-title">{advantage.title}</p>
                  <p className="paywall-advantage-description">{advantage.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="paywall-modal-buttons">
          <button
            type="button"
            className="paywall-subscribe-btn"
            onClick={handleSubscribeClick}
            disabled={isCreatingPayment}
          >
            <span className="paywall-subscribe-btn-title">Месяц</span>
            <span className="paywall-subscribe-btn-price">
              {isCreatingPayment ? 'Открываем оплату…' : '69 ₽/мес.'}
            </span>
          </button>
          <button type="button" className="paywall-close-btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
