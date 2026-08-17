import React, { useState } from 'react';
import { openExternalLink } from '../../utils/telegram';
import { ReportErrorModal } from '../ReportErrorModal/ReportErrorModal';
import './Footer.css';

const SUPPORT_URL = 'https://tbank.ru/cf/AMWtsUJl0nA';
// /privacy and /oferta are static HTML served directly by nginx, not React
// routes (see apps/frontend-miniapp/public/privacy.html, oferta.html) —
// deliberately built to open OUTSIDE Telegram in a normal mobile browser
// (DESIGNER_BRIEF_public_pages.md), so these go through openExternalLink
// like any other external URL, never React Router. window.location.origin
// (not a hardcoded prod domain) so this keeps working in dev/staging too.
const PRIVACY_URL = `${window.location.origin}/privacy`;
const OFERTA_URL = `${window.location.origin}/oferta`;

interface FooterProps {
  // Only ever passed by PatternDetails — "Источник информации: <host>",
  // linking to that pattern's own author's site (Author.site in the DB).
  // Absent everywhere else the Footer is used.
  sourceUrl?: string | null;
}

// The Figma label is just the bare host ("knitprofi.ru"), not the full
// URL it actually links to (which may include a path, e.g. "/shop").
const displayHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const handleLinkClick = (url: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  openExternalLink(url);
};

export const Footer: React.FC<FooterProps> = ({ sourceUrl }) => {
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  return (
    <footer className="app-footer">
      {sourceUrl && (
        <p className="footer-source">
          Источник информации:{' '}
          <a href={sourceUrl} className="footer-link" onClick={handleLinkClick(sourceUrl)}>
            {displayHost(sourceUrl)}
          </a>
        </p>
      )}
      <div className="footer-info">
        <div className="footer-left">
          <div className="footer-left-links">
            <a href={SUPPORT_URL} className="footer-link" onClick={handleLinkClick(SUPPORT_URL)}>
              Поддержать проект
            </a>
            <button type="button" className="footer-link footer-link--button" onClick={() => setIsReportModalOpen(true)}>
              Сообщить об ошибке
            </button>
          </div>
          <p className="footer-copyright">© {new Date().getFullYear()} Раппорт</p>
        </div>
        <div className="footer-right">
          <a href={PRIVACY_URL} className="footer-link" onClick={handleLinkClick(PRIVACY_URL)}>
            Политика конфиденциальности
          </a>
          <a href={OFERTA_URL} className="footer-link" onClick={handleLinkClick(OFERTA_URL)}>
            Договор оферты
          </a>
          {/* Same as "Сообщить об ошибке" was — styled, hidden, no destination yet. */}
          <span className="footer-link footer-link--hidden">Для авторов</span>
        </div>
      </div>

      <ReportErrorModal isOpen={isReportModalOpen} onClose={() => setIsReportModalOpen(false)} />
    </footer>
  );
};
