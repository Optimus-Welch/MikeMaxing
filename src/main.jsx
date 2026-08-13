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
  // Only an UPDATE should reload — and this must be sampled NOW, before any
  // worker claims the page. The previous version only guarded against
  // reloading twice, not against reloading on the very first registration:
  // with clientsClaim, a first-ever visit goes uncontrolled -> controlled and
  // fired a reload nobody needed. On the one page load where that is
  // expensive — landing from a magic link, mid PKCE exchange — it threw away
  // the in-flight sign-in and left the URL with a spent code.
  const wasControlled = Boolean(navigator.serviceWorker.controller);

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
