import { MotionConfig } from 'framer-motion'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/*
      `reducedMotion="user"` makes every Framer Motion animation in the app honour the
      OS setting. It matters more here than on a static page: this dashboard animates
      once a second, and a permanently moving surface is exactly what people who turn
      that setting on are trying to avoid. Transforms still resolve — elements land at
      their final position instead of being left mid-flight.
    */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
