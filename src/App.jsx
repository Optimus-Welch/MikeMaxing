import { HashRouter, Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import Today from './pages/Today.jsx';
import Settings from './pages/Settings.jsx';

// HashRouter (not BrowserRouter) so deep links/refreshes work once this is
// installed as a PWA, without needing a server rewrite rule.
export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <main className="app-content">
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
        <NavBar />
      </div>
    </HashRouter>
  );
}
