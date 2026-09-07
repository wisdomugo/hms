import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import Login from './screens/Login';
import Setup from './screens/Setup';
import Home from './screens/Home';
import Account from './screens/Account';
import Audit from './screens/Audit';
import Patients from './screens/Patients';
import PatientNew from './screens/PatientNew';
import PatientRecord from './screens/PatientRecord';
import Worklist from './screens/Worklist';
import Staff from './screens/Staff';
import ChangePassword from './screens/ChangePassword';
import { PRODUCT } from './lib/brand';

/*
 * Auth gates the whole shell rather than living behind a /login route.
 *
 * Gating before the router means the URL survives signing in — land on
 * /patients/42, sign in, and you are still on /patients/42 rather than bounced
 * to a dashboard.
 */
function Shell() {
  const { user, hospital, checking, needsSetup, unreachable, reason, retry, logout } = useAuth();

  if (checking) {
    return <div className="gate"><p className="gate__wait">Loading…</p></div>;
  }

  /*
   * A dead API must not render as a login screen. That looks like a working
   * install rejecting your password, so people try other passwords instead of
   * checking the server.
   */
  if (unreachable) {
    return (
      <div className="gate">
        <div className="gate__card">
          <h1 className="gate__title">Can’t reach the API</h1>
          <p className="gate__lede">{reason}</p>
          <button className="btn btn--primary" type="button" onClick={retry}>Try again</button>
          <p className="gate__foot">
            The app already retried three times before showing this, so a
            transient start-up delay has been ruled out.
          </p>
        </div>
      </div>
    );
  }

  if (!user && needsSetup) return <Setup />;
  if (!user) return <Login />;

  /*
   * A password issued by somebody else blocks the whole application, not just
   * some of it.
   *
   * This mirrors the API exactly: requirePasswordCurrent refuses every route
   * that touches hospital data while the flag is set. Rendering the shell here
   * would give a signed-in person a sidebar full of screens that all answer
   * 403 — which reads as a broken system rather than a deliberate stop.
   */
  if (user.mustChangePassword) return <ChangePassword />;

  // Placeholder until milestone 06. Hiding a link protects nothing — the API
  // refuses regardless — it just avoids showing a locked door.
  const isOwner = user.role === 'owner';

  return (
    <BrowserRouter basename="/app">
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <span className="sidebar__hospital">{hospital}</span>
            {/* The product name, under the hospital's own. One installation
                serves one hospital, so the hospital's name is the larger of
                the two — this line says what the thing they are using is
                called, not what it is. */}
            <span className="sidebar__system">{PRODUCT}</span>
          </div>

          <nav className="sidebar__nav" aria-label="Sections">
            <span className="sidebar__label">Records</span>
            <NavLink to="/" end>Today</NavLink>
            {/* `end` so /patients is not left highlighted while you are on
                /patients/42. */}
            <NavLink to="/patients" end>Patients</NavLink>
            <NavLink to="/worklist">Follow-up list</NavLink>

            <span className="sidebar__label">Settings</span>
            <NavLink to="/account">Account</NavLink>
            {isOwner && <NavLink to="/staff">Staff</NavLink>}
            {isOwner && <NavLink to="/audit">Audit log</NavLink>}
          </nav>

          <div className="sidebar__foot">
            <span className="sidebar__who">{user.name || user.email}</span>
            <span className="sidebar__role">{user.role}</span>
            <button className="btn btn--quiet" type="button" onClick={logout}>Sign out</button>
          </div>
        </aside>

        <main className="main">
          <Routes>
            {/* Today is the landing screen. Not a dashboard of charts — the
                day's outstanding work, plus the same search box, because an
                emergency file with no name on it is a person waiting somewhere
                and a search box never mentions them. */}
            <Route path="/" element={<Home />} />
            <Route path="/patients" element={<Patients />} />
            <Route path="/patients/new" element={<PatientNew />} />
            <Route path="/patients/:id" element={<PatientRecord />} />
            <Route path="/worklist" element={<Worklist />} />
            {/* The old address, kept so a bookmark from the pilot still works. */}
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route path="/account" element={<Account />} />
            {isOwner && <Route path="/staff" element={<Staff />} />}
            {isOwner && <Route path="/audit" element={<Audit />} />}
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
