import { useCallback, useEffect, useState } from 'react';

/*
 * Step 1's only screen, and it exists to prove exactly one thing: that this
 * app can reach the API THROUGH THE VITE PROXY.
 *
 * The content-type check is the point. When the proxy is not configured, the
 * dev server does not 404 — it serves index.html with a 200, because that is
 * what an SPA fallback does. Calling .json() on that throws
 * "Unexpected token '<'", which names nothing useful and sends people looking
 * at the API, at CORS, at the database.
 *
 * SiteSilo learned this the hard way and wrote an essay about it in
 * admin/src/auth/AuthContext.jsx. Proving the proxy now, while there is
 * nothing else in the system to blame, means it never has to be diagnosed
 * again with real code around it.
 *
 * Step 3 replaces this file with the real shell. The probe logic moves into
 * AuthContext, where it becomes the checking / ready / unreachable state
 * machine.
 */

async function probe() {
  const res = await fetch('/api/health');

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    throw new Error(
      `The API returned ${type || 'no content type'} instead of JSON. ` +
      'The dev server is most likely not proxying /api — check the server.proxy ' +
      'block in app/vite.config.js, and that the API is running on port 3000.'
    );
  }

  if (!res.ok) {
    throw new Error(
      `The API answered ${res.status} on /api/health, which should not happen ` +
      'on a healthy install.'
    );
  }

  return res.json();
}

export default function App() {
  const [state, setState] = useState({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;

    probe()
      .then(data => { if (alive) setState({ status: 'ready', data }); })
      .catch(err => {
        if (alive) {
          setState({
            status: 'failed',
            reason: err.message || 'Could not reach the API at all. Start it with ' +
              'npm run dev in the api folder, and confirm it is listening on port 3000.'
          });
        }
      });

    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'checking' });
    setAttempt(n => n + 1);
  }, []);

  return (
    <main className="shell">
      <header className="shell__head">
        <p className="eyebrow">Hospital Management System</p>
        <h1>Step 1 — scaffold</h1>
        <p className="sub">
          No modules yet. This screen exists to confirm the app, the API and the
          dev proxy are talking to each other.
        </p>
      </header>

      {state.status === 'checking' && (
        <p className="status status--wait">Checking the API…</p>
      )}

      {state.status === 'failed' && (
        <section className="status status--bad">
          <h2>Can’t reach the API</h2>
          <p>{state.reason}</p>
          <button type="button" onClick={retry}>Try again</button>
        </section>
      )}

      {state.status === 'ready' && (
        <section className="status status--ok">
          <h2>API reachable through the proxy</h2>
          <dl>
            <div><dt>Status</dt><dd>{state.data.status}</dd></div>
            <div><dt>Environment</dt><dd>{state.data.env}</dd></div>
            <div><dt>Node</dt><dd>{state.data.node}</dd></div>
            <div><dt>Uptime</dt><dd>{Math.round(state.data.uptime)}s</dd></div>
            <div><dt>Commit</dt><dd>{state.data.commit ?? 'not set (deploy.sh sets this)'}</dd></div>
            <div><dt>Migrations</dt><dd>{state.data.migrations ?? 'not reported yet (step 2)'}</dd></div>
          </dl>
          <button type="button" onClick={retry}>Check again</button>
        </section>
      )}
    </main>
  );
}
