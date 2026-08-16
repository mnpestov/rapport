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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), staticLegalPagesFallback()],
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/patterns': 'http://localhost:3000',
      '/images': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      '/filters': 'http://localhost:3000',
      '/favorites': 'http://localhost:3000',
      '/channel': 'http://localhost:3000',
      '/analytics': 'http://localhost:3000',
    }
  }
})
