import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Prod nginx serves public/oferta.html and public/privacy.html at the
// extension-free /oferta and /privacy via `try_files $uri $uri.html
// /index.html` (see DESIGNER_BRIEF_public_pages.md — these are deliberately
// static, non-React pages, opened outside the Telegram WebView/auth gate).
// Vite's dev server has no equivalent rule, so those paths fell through to
// the SPA shell locally — no React Router route matches them either,
// rendering blank. This replicates just that one nginx rule for dev parity;
// production is unaffected (nginx already does this).
const staticLegalPagesFallback = (): Plugin => ({
  name: 'static-legal-pages-fallback',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/oferta' || req.url === '/privacy') {
        req.url = `${req.url}.html`;
      }
      next();
    });
  },
});

// Один и тот же список для `pnpm dev` (server) и `pnpm preview` (preview).
// preview отдаёт прод-сборку из dist/ — это единственный способ увидеть
// локально плашку установки PWA: сигнал beforeinstallprompt Chrome шлёт
// только для прод-сборки, не для dev с HMR.
const apiProxy = {
  '/auth': 'http://localhost:3000',
  '/patterns': 'http://localhost:3000',
  '/images': 'http://localhost:3000',
  '/uploads': 'http://localhost:3000',
  '/filters': 'http://localhost:3000',
  // '/favorites' совпадает с React Router путём /favorites (Favorites.tsx)
  // — при прямом заходе/F5 на него браузер шлёт навигационный GET,
  // который без bypass тоже улетал бы на бэкенд как API-запрос без
  // Authorization и получал 401 вместо SPA-шелла. bypass пропускает
  // только настоящие навигации (Sec-Fetch-Mode: navigate) мимо прокси —
  // fetch/XHR к API этот заголовок не ставят и проксируются как обычно.
  '/favorites': {
    target: 'http://localhost:3000',
    bypass: (req: import('http').IncomingMessage) =>
      req.headers['sec-fetch-mode'] === 'navigate' ? req.url : undefined,
  },
  '/price-alerts': 'http://localhost:3000',
  '/channel': 'http://localhost:3000',
  '/analytics': 'http://localhost:3000',
  // /stash — хранилище пряжи (YARN_STASH_PLAN.md, T9). React Router уже
  // занимает этот путь (/stash, /stash/:id) — тот же bypass, что и у
  // /favorites, нужен по той же причине: прямая навигация/F5 должна отдать
  // SPA-шелл, а не улететь на бэкенд без Authorization.
  '/stash': {
    target: 'http://localhost:3000',
    bypass: (req: import('http').IncomingMessage) =>
      req.headers['sec-fetch-mode'] === 'navigate' ? req.url : undefined,
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), staticLegalPagesFallback()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
