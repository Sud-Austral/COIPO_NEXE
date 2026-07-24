/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En desarrollo, todo /api se proxya al backend Express (server/index.ts).
// La API key de Nexe vive SOLO en ese proceso (CLAUDE.md §3).
// VITE_BASE permite servir bajo una subruta (GitHub Pages: /COIPO_NEXE/).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
})
