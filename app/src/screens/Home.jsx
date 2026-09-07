import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { api, fullName, age } from '../lib/api';

/*
 * The landing screen: today, at a glance.
 *
 * WHY THIS EXISTS RATHER THAN LANDING ON THE PATIENT LIST.
 *
 * Going straight to the patient list is one click faster for the commonest
 * action, and that was the earlier choice. It is wrong for a different reason:
 * an emergency record with a temporary number and no name is a real person
 * sitting somewhere in the hospital, and nothing about a search box tells
 * anybody they exist. Work nobody is looking at is work that does not get done.
 * So the day's outstanding items are the first thing on screen — and the search
 * box is still here, one field down.
 *
 * WHAT IS DELIBERATELY NOT HERE: charts, trends, targets, anything with a
 * percentage in it. Every number on this screen is something somebody can act
 * on in the next ten minutes. A figure a receptionist cannot do anything about
 * is decoration, and decoration on the first screen of the morning teaches
 * people to stop reading the screen.
 */
export default function Home() {
  const { user, hospital } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading' });
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/api/summary/today')
      .then(data => { if (alive) setState({ status: 'ready', ...data }); })
      .catch(err => { if (alive) setState({ status: 'error', message: err.message }); });
    return () => { alive = false; };
  }, []);

  function search(event) {
    event.preventDefault();
    const term = q.trim();
    // Search-first is the rule for routine visits, so this hands off to the
    // patient list with the term already applied rather than searching here.
    // One search screen, not two that drift apart.
    navigate(term ? `/patients?q=${encodeURIComponent(term)}` : '/patients');
  }

  return (
    <div className="page page--wide">
      <header className="page__head">
        <h1>{hospital}</h1>
        <p className="page__sub">
          {greeting()}, {user.name || user.email}. {dayLabel(state.since)}
        </p>
      </header>

      <form className="searchbar" onSubmit={search}>
        <input
          className="searchbar__input"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by name, hospital number, old folder number or phone"
          aria-label="Search patients"
        />
        <button className="btn btn--primary" type="submit">Search</button>
        <Link className="btn" to="/patients/new">Register</Link>
      </form>

      {state.status === 'error' && <p className="msg msg--bad">{state.message}</p>}

      {state.status === 'ready' && (
        <>
          {/*
            * Ordered by urgency, not by size, and the tiles are always all
            * four — including the zeros. A screen whose tiles move around is a
            * screen people have to read rather than glance at.
            */}
          <div className="stats">
            <Stat
              label="Awaiting reconciliation"
              n={state.awaitingReconciliation}
              alert={state.awaitingReconciliation > 0}
              to="/worklist"
              note="Emergency files with no name yet"
            />
            <Stat
              label="Missing details"
              n={state.incompleteRecords}
              to="/worklist"
              note="Records worth going back to"
            />
            <Stat label="Registered today" n={state.registeredToday} to="/patients" />
            <Stat label="Visits opened today" n={state.visitsToday} />
          </div>

          <h2 className="section">
            Registered today
            <span className="section__count">{state.recent.length}</span>
          </h2>

          {state.recent.length === 0 ? (
            <div className="empty">
              <p>Nobody has been registered yet today.</p>
            </div>
          ) : (
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Hospital number</th>
                    <th>Name</th>
                    <th>Sex</th>
                    <th>Age</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {state.recent.map(p => (
                    <tr
                      key={p.id}
                      className="grid__row"
                      onClick={() => navigate(`/patients/${p.id}`)}
                    >
                      <td className="mono nowrap">{p.mrn}</td>
                      <td>
                        {fullName(p)}
                        {p.identityStatus === 'temporary' && (
                          <span className="chip chip--static">unreconciled</span>
                        )}
                      </td>
                      <td>{p.sex ?? '—'}</td>
                      <td>{age(p)}</td>
                      <td className="nowrap">{clock(p.registeredAt, state.timeZone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, n, note, to, alert }) {
  const body = (
    <>
      <span className="stat__n">{n}</span>
      <span className="stat__label">{label}</span>
      {note && <span className="stat__note">{note}</span>}
    </>
  );

  const className = `stat${alert ? ' stat--alert' : ''}${to ? ' stat--link' : ''}`;

  return to
    ? <Link className={className} to={to}>{body}</Link>
    : <div className={className}>{body}</div>;
}

/*
 * Times are rendered in the HOSPITAL's timezone, not the browser's.
 *
 * They almost always agree. When they do not — a doctor checking the list from
 * another country, a laptop with the wrong zone set — the hospital's clock is
 * the one that matters, because it is the clock on the wall next to the
 * patient. The server sends its zone with the data so the two cannot drift.
 */
function clock(value, timeZone) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleTimeString('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
}

function dayLabel(since) {
  if (!since) return '';
  return new Date(since).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
