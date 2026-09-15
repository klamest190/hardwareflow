import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative Asset-Pfade: Electron lädt die gebaute index.html über file://.
  base: './',
  plugins: [react(), tailwindcss()],
})
