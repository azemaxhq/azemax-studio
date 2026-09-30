import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Keep scroll position fully app-controlled (landing reveal animations and
// the IDE both manage their own scroll). Runs in the bundle (not an inline
// <script>) so the Content-Security-Policy needs no 'unsafe-inline'.
if ('scrollRestoration' in history) {
  try { history.scrollRestoration = 'manual'; } catch {}
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
