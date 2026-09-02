import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function Account() {
  const { user } = useAuth();

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setResult(null);

    // Checked here rather than on the server: the server has no idea what the
    // person meant to type twice, and a round trip to say so would be silly.
    if (form.newPassword !== form.confirm) {
      setError('The two new passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);

      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setResult(
        data.otherSessionsEnded > 0
          ? `Password changed. ${data.otherSessionsEnded} other session${data.otherSessionsEnded === 1 ? '' : 's'} signed out.`
          : 'Password changed.'
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page__head">
        <h1>Account</h1>
        <p className="page__sub">{user.email}</p>
      </header>

      <section className="panel panel--form">
        <h2>Change password</h2>
        <p className="panel__lede">
          Changing your password signs out every other device you are signed in
          on. This one stays signed in.
        </p>

        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Current password</span>
            <input
              type="password" value={form.currentPassword} required
              autoComplete="current-password" onChange={set('currentPassword')}
            />
          </label>

          <label className="field">
            <span>New password</span>
            <input
              type="password" value={form.newPassword} required minLength={10}
              autoComplete="new-password" onChange={set('newPassword')}
            />
            <small>At least 10 characters.</small>
          </label>

          <label className="field">
            <span>Repeat new password</span>
            <input
              type="password" value={form.confirm} required minLength={10}
              autoComplete="new-password" onChange={set('confirm')}
            />
          </label>

          {error && <p className="msg msg--bad">{error}</p>}
          {result && <p className="msg msg--ok">{result}</p>}

          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>
    </div>
  );
}
