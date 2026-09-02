import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

/*
 * A placeholder dashboard. It exists so there is somewhere to land after
 * signing in, and because /api/health is the clearest proof that the whole
 * chain works: hostname to hospital to database to session to user.
 *
 * Milestone 05 replaces this with something a receptionist would actually use —
 * patient search and the register button.
 */
export default function Home() {
  const { user, hospital } = useAuth();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then(r => r.json())
      .then(d => { if (alive) setHealth(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className="page">
      <header className="page__head">
        <h1>{hospital}</h1>
        <p className="page__sub">Signed in as {user.name || user.email}</p>
      </header>

      <section className="panel">
        <h2>Nothing here yet</h2>
        <p>
          Authentication is the whole of milestone 03. Patient registration
          arrives at milestone 05; until then this screen exists to show that
          the chain from hostname to hospital to database to session works.
        </p>
      </section>

      {health && (
        <section className="panel">
          <h2>This installation</h2>
          <dl className="kv">
            <div><dt>Hospital</dt><dd>{health.tenant?.name}</dd></div>
            <div><dt>Slug</dt><dd>{health.tenant?.slug}</dd></div>
            <div><dt>Resolved by</dt><dd>{health.tenant?.via}</dd></div>
            <div><dt>Migrations applied</dt><dd>{health.migrations}</dd></div>
            <div><dt>Environment</dt><dd>{health.env}</dd></div>
            <div><dt>Commit</dt><dd>{health.commit ?? 'not set'}</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}
