import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// A new deployment installs a new service worker, and skipWaiting/clientsClaim
// make it take control immediately — but the page you are looking at was
// already rendered from the OLD precached shell, so you keep seeing the old app
// until you happen to reload. That is how a "current" deploy can look like
// nothing changed. Reload once, the first time control changes hands.
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Guard against a reload loop: only act when we were already controlled,
    // i.e. this is an UPDATE, not the very first registration.
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
