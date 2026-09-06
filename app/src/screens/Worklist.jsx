import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, fullName, age, shortDate } from '../lib/api';

/*
 * The follow-up list.
 *
 * This screen is what makes "nothing is required" workable rather than merely
 * permissive. The system never refuses an incomplete registration, so it owes
 * the records officer a list of what still needs chasing — otherwise the gaps
 * are real but invisible, which is worse than a locked form.
 *
 * Two kinds of row, and the first is urgent in a way the second is not:
 *
 *   unreconciled  a live emergency patient with a TEMP number and no name
 *   incomplete    a normal record missing a surname or a date of birth
 */
export default function Worklist() {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    api.get('/api/worklists/incomplete')
      .then(data => { if (alive) setState({ status: 'ready', ...data }); })
      .catch(err => { if (alive) setState({ status: 'error', message: err.message }); });
    return () => { alive = false; };
  }, []);

  if (state.status === 'loading') return <div className="page"><p className="page__sub">Loading…</p></div>;
  if (state.status === 'error') return <div className="page"><p className="msg msg--bad">{state.message}</p></div>;

  const temporary = state.patients.filter(p => p.identityStatus === 'temporary');
  const incomplete = state.patients.filter(p => p.identityStatus !== 'temporary');

  return (
    <div className="page page--wide">
      <header className="page__head">
        <h1>Follow-up list</h1>
        <p className="page__sub">
          Records that still need something. Nothing here is an error — it is
          the work that replaces refusing an incomplete registration.
        </p>
      </header>

      {state.total === 0 && (
        <div className="empty"><p>Nothing outstanding.</p></div>
      )}

      {temporary.length > 0 && (
        <>
          <h2 className="section">
            Emergency files awaiting reconciliation
            <span className="section__count">{temporary.length}</span>
          </h2>
          <p className="page__sub">
            Each of these is a real patient with a temporary number. Once they
            are stable, open the record, fill in what is known and save — that
            issues a permanent hospital number.
          </p>
          <Rows rows={temporary} navigate={navigate} showTemp />
        </>
      )}

      {incomplete.length > 0 && (
        <>
          <h2 className="section">
            Records missing details
            <span className="section__count">{incomplete.length}</span>
          </h2>
          <Rows rows={incomplete} navigate={navigate} />
        </>
      )}
    </div>
  );
}

function Rows({ rows, navigate, showTemp }) {
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead>
          <tr>
            <th>{showTemp ? 'Temporary number' : 'Hospital number'}</th>
            <th>Name</th>
            <th>Sex</th>
            <th>Age</th>
            <th>Registered</th>
            <th>Still missing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id} className="grid__row" onClick={() => navigate(`/patients/${p.id}`)}>
              <td className="mono nowrap">{p.mrn}</td>
              <td>{fullName(p)}</td>
              <td>{p.sex ?? '—'}</td>
              <td>{age(p)}</td>
              <td className="nowrap">{shortDate(p.registeredAt)}</td>
              <td>
                <div className="meter meter--inline">
                  <div className="meter__bar" style={{ width: `${p.completeness.score}%` }} />
                </div>
                <span className="grid__hint">{p.completeness.missing.join(', ') || 'nothing'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
