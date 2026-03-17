import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// ── Version-based hard refresh ──
// Bump this string every time you deploy so returning users auto-reload.
const APP_VERSION = '2026.03.17.12';

(function checkVersion() {
  const stored = localStorage.getItem('spicesentry_version');
  if (stored !== APP_VERSION) {
    localStorage.setItem('spicesentry_version', APP_VERSION);
    // Clear service-worker / browser caches if available
    if ('caches' in window) {
      caches.keys().then(names => names.forEach(name => caches.delete(name)));
    }
    // Only reload if we actually had an old version (not first visit)
    if (stored) {
      window.location.reload(true);
      return;                       // stop — page will reload
    }
  }
})();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
