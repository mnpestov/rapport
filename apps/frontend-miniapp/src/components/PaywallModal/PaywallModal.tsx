import React, { useEffect, useRef, useState } from 'react';
import { submitPaywallImpression, submitPaywallEvent, PaywallSource } from '../../api/paywallApi';
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
import { useSheetTransition } from '../../hooks/useSheetTransition';
import '../../styles/sheet.css';
import './PaywallModal.css';

// Один и тот же компонент обслуживает три сценария — все они про "оплати
// подписку", отличаются только шапкой и наличием списка фич, а шторка,
// кнопки и логика оплаты общие (Figma: 970:12151 баннер, 975:5061 за 3 дня,
// 975:5217 за 1 день).
export type PaywallVariant = 'paywall' | 'expiring_3_days' | 'expiring_1_day' | 'active';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  variant?: PaywallVariant;
  // Только для варианта 'active' — дата в подзаголовке "до 20 сентября
  // 2026". ISO-строка из user_data (см. authController.ts).
  premiumExpiresAt?: string | null;
  // Только для variant='paywall': автопоказ или кнопка у поиска. Для
  // остальных вариантов источник выводится из самого варианта.
  source?: PaywallSource;
}

interface VariantConfig {
  title: string;
  // Пояснение под заголовком — только в варианте "за 3 дня", где нет списка
  // фич и нужно объяснить, что произойдёт.
  body?: string;
  // Подзаголовок над списком — только "за 1 день" ("Вы потеряете:").
  listHeading?: string;
  showLogoHeader: boolean;
  showAdvantages: boolean;
  ctaTitle: string;
}

const VARIANTS: Record<PaywallVariant, VariantConfig> = {
  paywall: {
    title: '',
    showLogoHeader: true,
    showAdvantages: true,
    ctaTitle: 'Оформить подписку',
  },
  expiring_3_days: {
    title: 'Ваша Премиум-подписка истекает через 3 дня',
    body: 'Чтобы не потерять доступ ко всем функциям, продлите подписку уже сейчас.',
    showLogoHeader: false,
    showAdvantages: false,
    ctaTitle: 'Продлить подписку',
  },
  expiring_1_day: {
    title: 'Через 1 день ваша Премиум-подписка закончится',
    listHeading: 'Вы потеряете:',
    showLogoHeader: false,
    showAdvantages: true,
    ctaTitle: 'Продлить подписку',
  },
  active: {
    title: 'Ваша Премиум-подписка активна',
    body: 'Все функции открыты.',
    showLogoHeader: false,
    showAdvantages: false,
    ctaTitle: 'Продлить на месяц',
  },
};

// Вариант шторки однозначно задаёт источник для аналитики, кроме обычного
// баннера: его можно открыть и автопоказом, и кнопкой у поиска, поэтому там
// источник приходит пропом (PAYMENTS_ROBOKASSA_PLAN.md §10.3).
const VARIANT_SOURCE: Record<Exclude<PaywallVariant, 'paywall'>, PaywallSource> = {
  expiring_3_days: 'EXPIRING_3_DAYS',
  expiring_1_day: 'EXPIRING_1_DAY',
  active: 'ACTIVE',
};

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

// "до 20 сентября 2026" — тот же формат, что в сообщении бота об оплате
// (paymentReceiptSender.ts), чтобы дата выглядела одинаково везде.
function formatExpiryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Copy + feature set from Figma node 970:12151 — matches PREMIUM_EXTRA 1:1
// (PAID_TIER_PERMISSIONS_PLAN.md §0), no discrepancy found when cross-checked.
const ADVANTAGES: Advantage[] = [
  { image: discountTag, title: 'Тег «Скидка»', text: 'Фильтруйте описания с акциями. Экономьте на том, что и так планировали купить.' },
  { image: priceVisibility, title: 'Видимость цены', text: 'Стоимость описания теперь сразу на карточке. Без лишних действий.' },
  { image: authorLink, title: 'Ссылка на автора', text: 'Переходите к другим работам мастера в один клик прямо со страницы описания.' },
  { image: priceSort, title: 'Сортировка по цене', text: 'Упорядочивайте модели — от дешёвых к дорогим или наоборот.' },
  { image: similarPatterns, title: 'Похожие модели', text: 'Рекомендации описаний со схожими характеристиками. Легко выбрать альтернативу.' },
  { image: multiPhoto, title: 'Серия фото', text: 'До 5 фотографий вместо одной. Рассмотрите модель со всех сторон.' },
  { image: priceFilter, title: 'Фильтр по цене', text: 'Отбирайте описания в нужном ценовом диапазоне.' },
  { image: favoritesFilters, title: 'Фильтры в Избранном', text: 'Находите нужное среди сохранёнок: по плотности, пряже, типу изделия.' },
  { image: yarnThicknessFilter, title: 'Фильтр по толщине пряжи', text: 'Подборка моделей под метраж вашей пряжи. Используйте то, что уже есть.' },
  { image: densityFilter, title: 'Фильтр по плотности', text: 'Находите описания, идеально подходящие под вашу плотность вязания. Никаких пересчётов.' },
];

export const PaywallModal: React.FC<PaywallModalProps> = ({ isOpen, onClose, variant = 'paywall', premiumExpiresAt, source }) => {
  // Держит шторку в дереве на время выезда вниз и даёт класс для
  // открытого состояния — сам по себе `isOpen` размонтировал бы её
  // мгновенно, до анимации закрытия.
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);
  const [isCreatingPayment, setIsCreatingPayment] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Долистывание засчитываем один раз за открытие: событие onScroll стреляет
  // десятками, а воронке нужен факт "дочитал", а не сколько раз он проскроллил
  // туда-обратно.
  const scrolledToEndRef = useRef(false);

  const eventSource: PaywallSource =
    variant === 'paywall' ? (source ?? 'AUTO_BANNER') : VARIANT_SOURCE[variant];

  // SHOWN пишется здесь, а не у вызывающего: шторка открывается из четырёх
  // мест, и раскладывать одно и то же событие по всем точкам вызова —
  // верный способ где-нибудь его забыть.
  useEffect(() => {
    if (!isOpen) return;
    scrolledToEndRef.current = false;
    submitPaywallEvent('SHOWN', eventSource);
  }, [isOpen, eventSource]);

  if (!isMounted) return null;

  const handleScroll = () => {
    if (scrolledToEndRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    // 24px допуска: на части устройств scrollTop не дотягивает до предела
    // ровно на доли пикселя, и строгое равенство никогда бы не сработало.
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 24) {
      scrolledToEndRef.current = true;
      submitPaywallEvent('SCROLLED_TO_END', eventSource);
    }
  };

  // Закрытие — кнопкой и тапом по затемнению считаем одинаково, различать
  // способ не просили (§10.2).
  const handleClose = () => {
    submitPaywallEvent('CLOSED', eventSource);
    onClose();
  };

  const config = VARIANTS[variant];

  // Click is tracked the same way the stub used to (separately from the
  // impression already recorded on open, App.tsx) — then a real Payment is
  // created and the user is sent to Robokassa via tg.openLink, not
  // openTelegramLink (that's for t.me deep links only, Robokassa's domain
  // isn't one — see PAYMENTS_ROBOKASSA_PLAN.md §3.5/§7 шаг 5). The modal is
  // left open on failure so the user can retry instead of losing the offer.
  const handleSubscribeClick = async () => {
    if (isCreatingPayment) return;
    submitPaywallImpression(true);
    submitPaywallEvent('SUBSCRIBE_CLICK', eventSource);
    setIsCreatingPayment(true);
    try {
      const paymentUrl = await createPayment(eventSource);
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
    <div ref={sheetRef} className={`paywall-modal-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={handleClose}>
      <div className="paywall-modal-content sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="paywall-modal-scroll" ref={scrollRef} onScroll={handleScroll}>
          <div className="paywall-modal-header">
            {config.showLogoHeader ? (
              <>
                <h1 className="paywall-modal-title">Расширьте возможности</h1>
                <img src={logo} alt="Rapport" className="paywall-modal-logo" />
                <h1 className="paywall-modal-title">с Премиум-подпиской</h1>
              </>
            ) : (
              <>
                <h1 className="paywall-modal-title">{config.title}</h1>
                {variant === 'active' && premiumExpiresAt && (
                  <p className="paywall-modal-body">до {formatExpiryDate(premiumExpiresAt)}</p>
                )}
                {config.body && (
                  <p className={variant === 'active' ? 'paywall-modal-note' : 'paywall-modal-body'}>
                    {config.body}
                  </p>
                )}
              </>
            )}
          </div>

          {config.listHeading && <p className="paywall-list-heading">{config.listHeading}</p>}

          {config.showAdvantages && (
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
          )}
        </div>

        <div className="paywall-modal-buttons">
          <button
            type="button"
            className="paywall-subscribe-btn"
            onClick={handleSubscribeClick}
            disabled={isCreatingPayment}
          >
            <span className="paywall-subscribe-btn-title">{config.ctaTitle}</span>
            <span className="paywall-subscribe-btn-price">
              {isCreatingPayment ? 'Открываем оплату…' : '69 ₽/мес.'}
            </span>
          </button>
          <button type="button" className="paywall-close-btn" onClick={handleClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
