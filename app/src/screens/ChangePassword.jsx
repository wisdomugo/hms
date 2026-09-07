import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

/*
 * The forced password change.
 *
 * Shown INSTEAD of the whole application — not as a route inside it — because
 * the API refuses every route that touches hospital data while this is owed.
 * A version of this that let you navigate would produce a shell full of screens
 * that all return 403, which reads as a broken application rather than a
 * deliberate stop.
 *
 * WHY IT STILL ASKS FOR THE TEMPORARY PASSWORD, having just accepted it at
 * sign-in: it reuses PATCH /api/auth/password, which requires the current one.
 * Adding an endpoint that changes a password without proving you know the
 * current one would mean a stolen session cookie could lock the real owner out
 * of their own account, which is a worse problem than retyping a password that
 * is written on the paper in front of them.
 */
export default function ChangePassword() {
  const { user, hospital, logout, retry } = useAuth();

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);

    if (form.newPassword !== form.confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    if (form.newPassword === form.currentPassword) {
      setError('The new password must be different from the temporary one.');
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

      // Re-ask the API who we are. The flag is cleared server-side, so this is
      // what takes the gate down and reveals the application.
      retry();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate__card" onSubmit={onSubmit}>
        <p className="gate__eyebrow">{hospital}</p>
        <h1 className="gate__title">Choose a password</h1>

        <p className="gate__lede">
          Someone else set the password you just used, and it was read aloud to
          you. Choose one only you know before going any further.
        </p>

        <label className="field">
          <span>The temporary password you were given</span>
          <input
            type="password" value={form.currentPassword}
            autoComplete="current-password" autoFocus required
            onChange={set('currentPassword')}
          />
        </label>

        <label className="field">
          <span>New password</span>
          <input
            type="password" value={form.newPassword}
            autoComplete="new-password" required minLength={10}
            onChange={set('newPassword')}
          />
          <small>At least 10 characters.</small>
        </label>

        <label className="field">
          <span>New password again</span>
          <input
            type="password" value={form.confirm}
            autoComplete="new-password" required
            onChange={set('confirm')}
          />
        </label>

        {error && <p className="msg msg--bad">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>

        <p className="gate__foot">
          Signed in as {user?.email}. Not you?{' '}
          <button className="btn btn--quiet btn--inline" type="button" onClick={logout}>
            Sign out
          </button>
        </p>
      </form>
    </div>
  );
}
