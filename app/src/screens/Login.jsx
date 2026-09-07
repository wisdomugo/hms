import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { PRODUCT } from '../lib/brand';

export default function Login() {
  const { login, hospital } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
    // No setBusy(false) on success: the shell replaces this screen, and
    // re-enabling a form that is about to unmount warns in the console.
  }

  return (
    <div className="gate">
      <form className="gate__card" onSubmit={onSubmit}>
        {/* The hospital's name, from the control plane. On a shared server this
            is how someone knows which hospital they are signing in to — the
            hostname alone is not always obvious on a shared workstation. */}
        <p className="gate__eyebrow">{hospital ?? PRODUCT}</p>
        <h1 className="gate__title">Sign in</h1>

        <label className="field">
          <span>Email</span>
          <input
            type="email" value={email} autoComplete="username" autoFocus required
            onChange={e => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password" value={password} autoComplete="current-password" required
            onChange={e => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="msg msg--bad">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
