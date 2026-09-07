import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, fullName, age, shortDate } from '../lib/api';

/*
 * The screen a receptionist lives on.
 *
 * ONE search box, not a form with a field per thing you might search by. A
 * receptionist is handed a folder, a phone, a name, or a scrap of paper with a
 * NIN on it — she should not have to decide which box it goes in. The API takes
 * any of them.
 *
 * The workflow document puts SEARCH FIRST for a reason: it is what stops a
 * second folder being opened for someone who already has one. So this is the
 * landing screen, and "Register new patient" is deliberately downstream of a
 * search rather than a button of its own on the sidebar.
 */
export default function Patients() {
  const navigate = useNavigate();

  // Seeded from ?q= so the search box on the Today screen can hand over here
  // with the term already in it. One search implementation, two ways in.
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [state, setState] = useState({ status: 'idle' });
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [error, setError] = useState(null);

  // Every keystroke would be a request, and a request per keystroke is also a
  // row per keystroke in the audit log. A short pause after typing stops both.
  const timer = useRef(null);

  const run = useCallback(async term => {
    if (term.trim().length < 2) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'searching' });
    try {
      const data = await api.get(`/api/patients?q=${encodeURIComponent(term)}`);
      setState({ status: 'done', ...data });
    } catch (err) {
      setState({ status: 'error', message: err.message });
    }
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(q), 350);
    return () => clearTimeout(timer.current);
  }, [q, run]);

  /*
   * The red button.
   *
   * One click, no form, straight to the record. The workflow document is
   * explicit that assessment comes before administration — a patient must not
   * wait at the desk while somebody types. Everything else is filled in later
   * from the worklist.
   */
  async function emergency() {
    setError(null);
    setEmergencyBusy(true);
    try {
      const { patient } = await api.post('/api/patients/emergency', {});
      navigate(`/patients/${patient.id}`);
    } catch (err) {
      setError(err.message);
      setEmergencyBusy(false);
    }
  }

  return (
    <div className="page page--wide">
      <header className="page__head page__head--split">
        <div>
          <h1>Patients</h1>
          <p className="page__sub">
            Search before registering. It is what stops a second folder being
            opened for someone who already has one.
          </p>
        </div>

        <button
          className="btn btn--danger"
          type="button"
          onClick={emergency}
          disabled={emergencyBusy}
        >
          {emergencyBusy ? 'Opening…' : 'Emergency'}
        </button>
      </header>

      {error && <p className="msg msg--bad">{error}</p>}

      <div className="searchbar">
        <input
          type="search"
          className="searchbar__input"
          placeholder="Name, phone number, hospital number, NIN, HMO number…"
          value={q}
          autoFocus
          onChange={e => setQ(e.target.value)}
        />
        <Link className="btn btn--primary btn--inline" to="/patients/new">
          Register new patient
        </Link>
      </div>

      {state.status === 'idle' && (
        <p className="page__sub">Type at least two characters.</p>
      )}
      {state.status === 'searching' && <p className="page__sub">Searching…</p>}
      {state.status === 'error' && <p className="msg msg--bad">{state.message}</p>}

      {state.status === 'done' && (
        <>
          <p className="page__sub">
            {state.total} {state.total === 1 ? 'match' : 'matches'}
          </p>

          {state.total === 0 ? (
            <div className="empty">
              <p>No record found for “{q}”.</p>
              <Link className="btn btn--primary btn--inline" to={`/patients/new?surname=${encodeURIComponent(q)}`}>
                Register a new patient
              </Link>
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
                    <th>Date of birth</th>
                    <th>Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {state.patients.map(p => (
                    <tr key={p.id} className="grid__row" onClick={() => navigate(`/patients/${p.id}`)}>
                      <td className="mono nowrap">
                        {p.mrn}
                        {/* An unreconciled emergency file has to be obvious in
                            a list, not only on the record. */}
                        {p.identityStatus === 'temporary' && (
                          <span className="pill pill--denied">unreconciled</span>
                        )}
                      </td>
                      <td>{fullName(p)}</td>
                      <td>{p.sex ?? '—'}</td>
                      <td>{age(p)}</td>
                      <td className="nowrap">{shortDate(p.dateOfBirth)}</td>
                      <td className="mono nowrap">{p.phone ?? '—'}</td>
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
