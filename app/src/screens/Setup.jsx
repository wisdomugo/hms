import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

/*
 * Shown when a hospital has no accounts yet.
 *
 * setupAvailable is checked separately from needsSetup: a hospital with no
 * accounts and no token left is stuck, and saying so is more useful than
 * offering a form that cannot succeed.
 */
export default function Setup() {
  const { setup, hospital, setupAvailable } = useAuth();

  const [form, setForm] = useState({ token: '', name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  if (!setupAvailable) {
    return (
      <div className="gate">
        <div className="gate__card">
          <p className="gate__eyebrow">{hospital ?? 'Hospital Management System'}</p>
          <h1 className="gate__title">Setup unavailable</h1>
          <p className="gate__lede">
            This hospital has no accounts, and its setup token has already been
            used or was never issued. A new one has to be set in the control
            plane before the first account can be created.
          </p>
        </div>
      </div>
    );
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await setup(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate__card" onSubmit={onSubmit}>
        <p className="gate__eyebrow">{hospital ?? 'Hospital Management System'}</p>
        <h1 className="gate__title">Create the first account</h1>
        <p className="gate__lede">
          This hospital has no accounts yet. The setup token was printed once,
          when the hospital was onboarded.
        </p>

        <label className="field">
          <span>Setup token</span>
          <input
            type="text" value={form.token} autoFocus required spellCheck="false"
            className="field__mono" onChange={set('token')}
          />
        </label>

        <label className="field">
          <span>Your name</span>
          <input type="text" value={form.name} autoComplete="name" onChange={set('name')} />
        </label>

        <label className="field">
          <span>Email</span>
          <input
            type="email" value={form.email} autoComplete="username" required
            onChange={set('email')}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password" value={form.password} autoComplete="new-password"
            required minLength={10} onChange={set('password')}
          />
          <small>At least 10 characters.</small>
        </label>

        {error && <p className="msg msg--bad">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account and sign in'}
        </button>
      </form>
    </div>
  );
}
