import { useCallback, useEffect, useState } from 'react';

/*
 * The audit log, newest first.
 *
 * Plain on purpose. This screen is read when something has gone wrong or
 * somebody is being asked to account for an action, and in that situation a
 * dense, boring, complete list is worth more than a designed one.
 */

const LABELS = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Sign-in failed',
  'auth.login_locked': 'Locked out',
  'auth.logout': 'Signed out',
  'auth.password_changed': 'Password changed',
  'auth.setup_completed': 'First account created',
  'auth.setup_rejected': 'Setup token rejected'
};

const when = iso => new Date(iso).toLocaleString(undefined, {
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});

export default function Audit() {
  const [state, setState] = useState({ loading: true });
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const qs = filter ? `?outcome=${encodeURIComponent(filter)}` : '';
      const res = await fetch(`/api/audit${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setState({ loading: false, ...data });
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page page--wide">
      <header className="page__head">
        <h1>Audit log</h1>
        <p className="page__sub">
          Every recorded action, newest first. Nothing here can be edited or
          deleted.
        </p>
      </header>

      <div className="toolbar">
        {['', 'ok', 'failed', 'denied'].map(value => (
          <button
            key={value || 'all'}
            type="button"
            className={`chip${filter === value ? ' chip--on' : ''}`}
            onClick={() => setFilter(value)}
          >
            {value === '' ? 'All' : value}
          </button>
        ))}
        <button className="btn btn--quiet btn--inline" type="button" onClick={load}>
          Refresh
        </button>
      </div>

      {state.loading && <p className="page__sub">Loading…</p>}
      {state.error && <p className="msg msg--bad">{state.error}</p>}

      {state.events && (
        <>
          <p className="page__sub">
            {state.total} event{state.total === 1 ? '' : 's'}
            {state.total > state.events.length && ` — showing the most recent ${state.events.length}`}
          </p>

          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Who</th>
                  <th>Outcome</th>
                  <th>Subject</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {state.events.map(e => (
                  <tr key={e.id}>
                    <td className="mono nowrap">{when(e.at)}</td>
                    <td>
                      {LABELS[e.action] ?? e.action}
                      {/* The raw name too. The label is for reading; the raw
                          name is what anyone filtering or reporting needs. */}
                      <span className="grid__hint">{e.action}</span>
                    </td>
                    <td>
                      {e.actorEmail ?? <span className="grid__hint">— not signed in</span>}
                      {e.meta?.email && !e.actorEmail && (
                        <span className="grid__hint">tried: {e.meta.email}</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill pill--${e.outcome}`}>{e.outcome}</span>
                    </td>
                    <td className="mono">
                      {e.entity ? `${e.entity} ${e.entityId}` : ''}
                    </td>
                    <td className="mono nowrap">{e.ip ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {state.events.length === 0 && (
            <p className="page__sub">Nothing recorded yet.</p>
          )}
        </>
      )}
    </div>
  );
}
