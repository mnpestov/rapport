import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Backend proxy will be added here when API integration starts, e.g.:
    // proxy: { '/auth': 'http://localhost:3000', '/admin': 'http://localhost:3000' }
  },
})
