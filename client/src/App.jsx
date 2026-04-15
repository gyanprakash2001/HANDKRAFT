import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import FeedPage from './pages/FeedPage';
import ProductPage from './pages/ProductPage';

function AppShell() {
  return (
    <div className="app-shell">
      <div className="ambient ambient-top" aria-hidden="true" />
      <div className="ambient ambient-bottom" aria-hidden="true" />

      <header className="site-header">
        <Link to="/" className="brand-block" aria-label="Open HANDKRAFT feed">
          <span className="brand-kicker">Handmade marketplace</span>
          <span className="brand-title">HANDKRAFT</span>
        </Link>

        <nav className="top-nav" aria-label="Primary navigation">
          <NavLink to="/" end>
            Feed
          </NavLink>
          <a href="https://gyanprakash2001.github.io/HANDKRAFT/" target="_blank" rel="noreferrer">
            Android beta
          </a>
        </nav>
      </header>

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}

function NotFoundPage() {
  return (
    <section className="empty-state">
      <h2>Page not found</h2>
      <p>This route does not exist in the web storefront yet.</p>
      <Link to="/" className="ghost-btn inline-ghost">
        Return to feed
      </Link>
    </section>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<FeedPage />} />
          <Route path="product/:productId" element={<ProductPage />} />
          <Route path="404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
