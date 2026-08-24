/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En desarrollo, /api se proxya al backend FastAPI (uvicorn en :8000). En producción
// ese proxy lo hace nginx dentro del contenedor `app` (frontend/nginx.conf), así que
// el navegador siempre habla con el MISMO origen y no hay CORS en ninguna parte.
// VITE_BASE permite servir bajo una subruta (GitHub Pages: /coipo_nexe/).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.BACKEND_URL ?? 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
})
