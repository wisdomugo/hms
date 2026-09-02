import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import Login from './screens/Login';
import Setup from './screens/Setup';
import Home from './screens/Home';
import Account from './screens/Account';

/*
 * Auth gates the whole shell rather than living behind a /login route.
 *
 * Gating before the router means the URL survives signing in — land on
 * /patients/42, sign in, and you are still on /patients/42 rather than bounced
 * to a dashboard. It also means there is no redirect logic at all. The
 * trade-off is that the login screen has no address of its own, which for a
 * staff application nobody deep-links into is a non-issue.
 */
function Shell() {
  const { user, hospital, checking, needsSetup, unreachable, reason, retry, logout } = useAuth();

  // Prevents a flash of the login card on every page load while /me is in
  // flight.
  if (checking) {
    return <div className="gate"><p className="gate__wait">Loading…</p></div>;
  }

  /*
   * The API could not be reached, or answered something that makes no sense.
   *
   * This must not fall through to the login form. A dead API rendered as a
   * login screen looks like a working install rejecting your password, so
   * people try other passwords instead of checking the server.
   */
  if (unreachable) {
    return (
      <div className="gate">
        <div className="gate__card">
          <h1 className="gate__title">Can’t reach the API</h1>
          <p className="gate__lede">{reason}</p>
          <button className="btn btn--primary" type="button" onClick={retry}>
            Try again
          </button>
          <p className="gate__foot">
            The app already retried three times before showing this, so a
            transient start-up delay has been ruled out.
          </p>
        </div>
      </div>
    );
  }

  // A hospital with no accounts. Offering a login form nobody can satisfy would
  // be a dead end.
  if (!user && needsSetup) return <Setup />;

  if (!user) return <Login />;

  return (
    <BrowserRouter basename="/app">
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <span className="sidebar__hospital">{hospital}</span>
            <span className="sidebar__system">Hospital Management System</span>
          </div>

          <nav className="sidebar__nav" aria-label="Sections">
            <span className="sidebar__label">Clinical</span>
            <NavLink to="/">Home</NavLink>
            {/* Patients, Appointments and the rest attach here as their
                modules land. Milestone 05 adds the first. */}

            <span className="sidebar__label">Settings</span>
            <NavLink to="/account">Account</NavLink>
          </nav>

          <div className="sidebar__foot">
            <span className="sidebar__who">{user.name || user.email}</span>
            <span className="sidebar__role">{user.role}</span>
            <button className="btn btn--quiet" type="button" onClick={logout}>
              Sign out
            </button>
          </div>
        </aside>

        <main className="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
