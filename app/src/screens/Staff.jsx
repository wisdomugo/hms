import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, shortDate } from '../lib/api';

/*
 * Staff administration. Owner only.
 *
 * One action for now — issue a temporary password — because that was the one
 * thing standing between this system and a hospital using it. Creating
 * accounts, deactivating them and assigning roles arrive in milestone 07,
 * together, when there are roles to assign.
 *
 * THE PASSWORD IS SHOWN ONCE and cannot be retrieved. That is not a limitation
 * to apologise for: it is never stored, only its scrypt hash is, so there is
 * nothing to show a second time. The screen says so plainly rather than letting
 * someone close the panel and then go looking for it.
 */
export default function Staff() {
  const { user } = useAuth();

  const [state, setState] = useState({ status: 'loading' });
  const [issued, setIssued] = useState(null);   // { user, password, sessionsEnded }
  const [confirming, setConfirming] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'staff' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/users');
      setState({ status: 'ready', users: data.users });
    } catch (err) {
      setState({ status: 'error', message: err.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.post('/api/users', form);
      // Same panel as a reset, because it is the same thing to the new person:
      // a password somebody else knows, to be replaced immediately.
      setIssued(data);
      setForm({ email: '', name: '', role: 'staff' });
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset(target) {
    setBusy(true);
    setError(null);
    try {
      const data = await api.post(`/api/users/${target.id}/reset-password`, {});
      setIssued(data);
      setConfirming(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return <div className="page"><p className="page__sub">Loading…</p></div>;
  }
  if (state.status === 'error') {
    return <div className="page"><p className="msg msg--bad">{state.message}</p></div>;
  }

  return (
    <div className="page page--wide">
      <header className="page__head">
        <h1>Staff</h1>
        <p className="page__sub">
          Everyone who can sign in to this hospital. Resetting a password ends
          every session that account has open.
        </p>
      </header>

      {/* The issued password. Deliberately loud, deliberately dismissible only
          by an explicit click — a panel that vanished on the next render would
          take the one copy of the password with it. */}
      {issued && (
        <section className="panel panel--quiet">
          <h2>Temporary password for {issued.user.email}</h2>
          {issued.user.role && (
            <p className="panel__lede">Added as {issued.user.role}.</p>
          )}
          <p className="issued">{issued.password}</p>
          <p className="panel__lede">
            Read it to them yourself. Do not send it by SMS or email — those
            keep a copy long after the conversation is over. They will be asked
            to choose their own password the moment they sign in, and can do
            nothing else until they have.
          </p>
          <p className="panel__lede">
            {issued.sessionsEnded === 0
              ? 'They had no sessions open.'
              : `${issued.sessionsEnded} open session${issued.sessionsEnded === 1 ? '' : 's'} ended, so anyone holding that account is now signed out.`}
          </p>
          <p className="panel__lede">
            <strong>This is shown once.</strong> Only a hash is stored, so it
            cannot be displayed again — if it is lost, issue another.
          </p>
          <button className="btn" type="button" onClick={() => setIssued(null)}>
            I have written it down
          </button>
        </section>
      )}

      {error && <p className="msg msg--bad">{error}</p>}

      {adding ? (
        <form className="panel panel--form" onSubmit={add}>
          <h2>Add someone</h2>
          <p className="panel__lede">
            No password is typed here, by you or by them. The account is created
            with a temporary one, which you read to them, and they choose their
            own before they can do anything. That way no password the audit log
            attributes to them is one you have ever known.
          </p>

          <div className="row row--2">
            <label className="field">
              <span>Email</span>
              <input
                type="email" value={form.email} required autoFocus
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>Name</span>
              <input
                type="text" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </label>
          </div>

          <label className="field">
            <span>Role</span>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            >
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
            <small>
              Owners can add and reset other accounts, and read the audit log.
              Have at least two — an owner is the only account that can rescue the
              others, so a single one is a single point of failure with a
              person's memory attached to it. Until milestone 07 these two are
              the only roles, and neither restricts what can be done to patient
              records.
            </small>
          </label>

          <div className="formfoot">
            <div className="formfoot__actions">
              <button className="btn btn--primary" type="submit" disabled={busy}>
                {busy ? 'Adding…' : 'Add and issue a password'}
              </button>
              <button
                className="btn btn--quiet" type="button"
                onClick={() => { setAdding(false); setError(null); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="toolbar">
          <button className="btn btn--primary" type="button" onClick={() => setAdding(true)}>
            Add someone
          </button>
        </div>
      )}

      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state.users.map(u => (
              <tr key={u.id}>
                <td className="mono nowrap">{u.email}</td>
                <td>{u.name ?? '—'}</td>
                <td>{u.role}</td>
                <td>
                  {!u.isActive && <span className="chip chip--static">deactivated</span>}
                  {u.isActive && u.mustChangePassword &&
                    <span className="chip chip--static">owes a password change</span>}
                  {u.isActive && !u.mustChangePassword && '—'}
                </td>
                <td className="nowrap">{shortDate(u.createdAt)}</td>
                <td className="nowrap">
                  {u.id === user.id ? (
                    /* Your own row has no button. Resetting yourself here would
                       end the session you are using, mid-click. Account does
                       the same job without signing you out. */
                    <span className="grid__hint">you — use Account</span>
                  ) : confirming === u.id ? (
                    <>
                      <button
                        className="btn btn--danger btn--tiny" type="button"
                        disabled={busy} onClick={() => reset(u)}
                      >
                        {busy ? 'Working…' : 'Yes, reset it'}
                      </button>{' '}
                      <button
                        className="btn btn--quiet btn--tiny" type="button"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn--tiny" type="button"
                      onClick={() => { setConfirming(u.id); setError(null); }}
                    >
                      Reset password
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="page__sub">
        Locked out of the owner account itself, with nobody here able to help?
        That one is recovered from the server console, not from this screen —
        see DEPLOYMENT.md.
      </p>
    </div>
  );
}
