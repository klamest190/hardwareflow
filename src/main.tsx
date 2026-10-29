import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'
import { MiniView } from './MiniView.tsx'
import './index.css'

// The mini window loads the same bundle with `#mini`; one build serves both views.
const mini = window.location.hash === '#mini'
if (mini) document.documentElement.classList.add('hf-mini')
// The main window may sit on a Mica backdrop; the title strip and sidebar let it through.
else if (window.hardwareflow?.backdrop === 'mica') document.documentElement.classList.add('hf-mica')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{mini ? <MiniView /> : <App />}</StrictMode>,
)
