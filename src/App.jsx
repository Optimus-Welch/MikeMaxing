import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import Today from './pages/Today.jsx';
import Settings from './pages/Settings.jsx';
import Run from './pages/Run.jsx';
import Finish from './pages/Finish.jsx';

// HashRouter (not BrowserRouter) so deep links/refreshes work once this is
// installed as a PWA, without needing a server rewrite rule.
export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const { pathname } = useLocation();
  // Run mode is full-screen and hides the tab bar — while you are mid-set the
  // only thing on screen should be the set.
  const immersive = pathname === '/run';

  if (immersive) {
    return (
      <Routes>
        <Route path="/run" element={<Run />} />
      </Routes>
    );
  }

  return (
    <div className="app-shell">
      <main className="app-content">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/finish" element={<Finish />} />
        </Routes>
      </main>
      <NavBar />
    </div>
  );
}
