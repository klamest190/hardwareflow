import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Content-Security-Policy for the built renderer only. The dev server injects inline
 * scripts and a WebSocket for hot reload that a strict policy would block, so the meta
 * tag is added at build time instead of living in index.html.
 *
 * Inline *styles* stay allowed: React writes chart colours and meter widths into
 * `style` attributes, and the policy's job here is to stop injected scripts, which it
 * still does.
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

  return {
    name: 'hardwareflow-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative Asset-Pfade: Electron lädt die gebaute index.html über file://.
  base: './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: {
    rolldownOptions: {
      output: {
        // Charts and animation are most of the bundle and change less often than the app.
        codeSplitting: {
          groups: [
            { name: 'charts', test: /node_modules[\\/](recharts|d3-|victory-vendor|es-toolkit|immer|reselect|@reduxjs|react-redux)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
          ],
        },
      },
    },
  },
})
