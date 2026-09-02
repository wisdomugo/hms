import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/*
 * A response can be "ok" and still be useless.
 *
 * When the dev server is not proxying /api it does not 404 — it serves
 * index.html with a 200, because that is what an SPA fallback does. Calling
 * .json() on that throws "Unexpected token '<'", which names nothing useful.
 * Checking the content type turns a baffling symptom into a nameable cause.
 */
async function readJson(res, endpoint) {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    const err = new Error(`${endpoint} returned ${type || 'no content type'}, expected JSON`);
    err.kind = 'not-json';
    throw err;
  }
  return res.json();
}

// Every branch names a specific thing to check. "Failed to fetch" on a first
// run tells you nothing about which of five setup steps was missed.
function describe(err) {
  if (err?.kind === 'not-json') {
    return 'The API returned HTML instead of JSON. The dev server is most likely not proxying /api — check the server.proxy block in app/vite.config.js, and that the API is on port 3000.';
  }
  if (err?.kind === 'http') {
    if (err.status === 404) {
      return 'The API did not recognise this address as belonging to any hospital. Check DEFAULT_TENANT in api/.env, or onboard one with: npm run onboard.';
    }
    if (err.status === 503) {
      return 'This hospital is registered but still marked as onboarding, so the API is refusing requests for it.';
    }
    if (err.status === 403) {
      return 'This hospital is marked as suspended in the control plane.';
    }
    if (err.status >= 500) {
      return `The API answered ${err.status} on ${err.endpoint}. It is running but something behind it is not: check CONTROL_PLANE_URL in api/.env, that both databases exist, and that migrations have been applied.`;
    }
    return `The API answered ${err.status} on ${err.endpoint}, which should not happen on a healthy install.`;
  }
  return 'Could not reach the API at all. Start it with npm run dev in the api folder, and confirm it is listening on port 3000.';
}

function httpError(res, endpoint) {
  const err = new Error(`Unexpected ${res.status}`);
  err.kind = 'http';
  err.status = res.status;
  err.endpoint = endpoint;
  return err;
}

async function probe() {
  // The session cookie is httpOnly, so the browser cannot inspect it. Asking
  // the server is the only way to know whether we are signed in.
  const meRes = await fetch('/api/auth/me');

  if (meRes.ok) {
    const data = await readJson(meRes, '/api/auth/me');
    return { status: 'ready', user: data.user, hospital: data.hospital };
  }

  // 401 is the expected "not signed in" answer. Anything else is a fault, and
  // must not be mistaken for one — a 404 here means the hostname resolved to no
  // hospital, which is a configuration problem, not a login problem.
  if (meRes.status !== 401) throw httpError(meRes, '/api/auth/me');

  // Not signed in. Second question: does this hospital have any accounts?
  const statusRes = await fetch('/api/auth/status');
  if (!statusRes.ok) throw httpError(statusRes, '/api/auth/status');

  const data = await readJson(statusRes, '/api/auth/status');
  return {
    status: 'ready',
    user: null,
    hospital: data.hospital,
    needsSetup: Boolean(data.needsSetup),
    setupAvailable: Boolean(data.setupAvailable)
  };
}

/*
 * Never rejects — resolves to a state object either way, so the caller has no
 * error path to forget.
 *
 * The retries are the important part. The common first-run failure is not a
 * broken install but the app loading a moment before the API has finished
 * booting, which resolves itself in under a second. A login screen that needs a
 * manual refresh does not.
 */
async function probeWithRetry(attempts = 3) {
  for (let i = 0; ; i++) {
    try {
      return await probe();
    } catch (err) {
      if (i >= attempts - 1) return { status: 'unreachable', reason: describe(err) };
      await sleep(400 * (i + 1));
    }
  }
}

export function AuthProvider({ children }) {
  /*
   * THREE OUTCOMES, NOT TWO.
   *
   * Tracking only "signed in / not signed in" means an API that is down, a
   * database with no tables, and a hostname that matches no hospital all render
   * the same login screen — which looks like a working install rejecting your
   * password, so you try other passwords instead of checking the server.
   *
   * 'checking' | 'ready' (with user, or needsSetup) | 'unreachable' (with a
   * reason worth reading).
   */
  const [auth, setAuth] = useState({ status: 'checking' });

  // Bumping this re-runs the effect. Retrying by changing an input rather than
  // by calling a function keeps every setState inside a promise callback.
  const [attemptNo, setAttemptNo] = useState(0);

  useEffect(() => {
    let alive = true;
    probeWithRetry().then(result => { if (alive) setAuth(result); });
    return () => { alive = false; };
  }, [attemptNo]);

  const check = useCallback(() => {
    setAuth({ status: 'checking' });
    setAttemptNo(n => n + 1);
  }, []);

  const user = auth.status === 'ready' ? auth.user : null;

  const setUser = useCallback((next, hospital) => {
    setAuth(prev => ({
      status: 'ready',
      user: next,
      hospital: hospital ?? prev.hospital,
      needsSetup: false,
      setupAvailable: false
    }));
  }, []);

  /*
   * Intercept 401s globally, so an expired session returns you to the login
   * screen wherever it happens — including on a ward computer left open across
   * a shift change, which is the case this exists for.
   *
   * /api/auth/ is excluded: a wrong password returns 401 too, and that should
   * surface as a form error rather than a silent state change.
   */
  useEffect(() => {
    const original = window.fetch;

    window.fetch = async (...args) => {
      const res = await original(...args);
      const url = String(args[0] ?? '');
      if (res.status === 401 && !url.includes('/api/auth/')) {
        setAuth(prev => ({ ...prev, status: 'ready', user: null }));
      }
      return res;
    };

    return () => { window.fetch = original; };
  }, []);

  const post = useCallback(async (path, body) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await post('/api/auth/login', { email, password });
    setUser(data.user);
  }, [post, setUser]);

  const setup = useCallback(async ({ token, email, password, name }) => {
    const data = await post('/api/auth/setup', { token, email, password, name });
    setUser(data.user);
  }, [post, setUser]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    // Not setUser(null) — that would assert "signed out, and no setup needed"
    // without having asked. Re-probing costs one request and keeps the three
    // states honest.
    check();
  }, [check]);

  const value = {
    user,
    hospital: auth.hospital ?? null,
    checking: auth.status === 'checking',
    needsSetup: auth.status === 'ready' && Boolean(auth.needsSetup),
    setupAvailable: auth.status === 'ready' && Boolean(auth.setupAvailable),
    unreachable: auth.status === 'unreachable',
    reason: auth.reason ?? null,
    retry: check,
    login,
    logout,
    setup
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
