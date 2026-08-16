// Opens a regular (non t.me) external URL outside the Telegram WebView.
// tg.openLink is the correct API for this — unlike tg.openTelegramLink
// (t.me deep links, see SubscriptionRequired.tsx's own handlers, a
// different case not unified here) it doesn't try to interpret the URL as
// a Telegram destination. Falls back to window.open when the WebApp bridge
// isn't available (e.g. testing in a plain browser tab). Was duplicated
// inline in PatternDetails.tsx's handleOpenLink before Footer.tsx needed
// the exact same fallback for several more links.
export function openExternalLink(url: string): void {
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, '_blank');
  }
}
