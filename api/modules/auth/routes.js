import express from 'express';
import { COOKIE_NAME, cookieOptions, requireAuth } from '../../lib/session.js';
import { verifySetupToken, clearSetupToken, hasSetupToken } from '../../lib/control-plane.js';
import * as auth from './service.js';

const router = express.Router();

/*
 * MIXED ROUTER.
 *
 * Public:  POST /login, POST /logout, GET /status, POST /setup
 * Guarded: GET /me, PATCH /password
 *
 * Guarded individually rather than at the mount point, because most of this
 * router has to be reachable without a session — that is what it is for. Each
 * exception is marked at its route.
 *
 * Every route here runs after resolveTenant, so req.prisma is the hospital's
 * database and req.tenant says which hospital.
 */

/*
 * Nothing under /auth may be cached.
 *
 * Express enables ETags on JSON by default, which makes /me and /status answer
 * 304. Harmless with fetch — the browser turns a 304 into a 200 with the stored
 * body — but the wrong property for these two to have. They report who you are
 * and whether this hospital has any accounts yet, and a stale answer to either
 * is worse than a slow one: a cached "needsSetup: true" would offer the setup
 * screen to a hospital that already has an owner.
 *
 * no-store rather than no-cache: no-cache still stores and revalidates, which
 * is precisely the round trip being removed.
 */
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const key = String(email).toLowerCase().trim();

    if (await auth.isLockedOut(req.prisma, key)) {
      return res.status(429).json({
        error: 'Too many attempts. Try again in a few minutes.'
      });
    }

    const user = await auth.authenticate(req.prisma, key, password);

    // One message for an unknown email, a wrong password and a deactivated
    // account. Three different messages would turn this endpoint into a way to
    // discover which staff emails are real.
    if (!user) {
      await auth.recordFailure(req.prisma, key);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await auth.clearFailures(req.prisma, key);

    const token = await auth.startSession(req.prisma, user.id);
    res.cookie(COOKIE_NAME, token, cookieOptions());

    // Must match the shape returned by /me and /setup — the app reads
    // user.role from whichever of the three it happened to receive.
    res.json({ user: auth.publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
//
// Public: logging out with an expired or missing session should succeed
// quietly, not 401. The caller wants to end up signed out either way.
// ---------------------------------------------------------------------------
router.post('/logout', async (req, res, next) => {
  try {
    await auth.endSession(req.prisma, req.cookies?.[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me   — guarded
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, hospital: req.tenant.name });
});

// ---------------------------------------------------------------------------
// GET /api/auth/status
//
// What the app asks before showing anything. Three facts, and the hospital's
// name so the login screen can say which hospital it belongs to.
//
// setupAvailable is separate from needsSetup on purpose. A hospital with no
// accounts and no token left is stuck, and the app should say so rather than
// showing a setup form that cannot succeed.
// ---------------------------------------------------------------------------
router.get('/status', async (req, res, next) => {
  try {
    res.json({
      hospital: req.tenant.name,
      needsSetup: await auth.needsSetup(req.prisma),
      setupAvailable: await hasSetupToken(req.tenant.id)
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/setup
//
// Creates the first account for THIS hospital, authorised by the single-use
// token that onboard.mjs generated and printed.
//
// The token lives in the control plane rather than the environment. One
// SETUP_TOKEN in .env is one token for the whole server — on a shared server
// that means whoever holds it can claim the first account at any hospital that
// has not been set up yet.
// ---------------------------------------------------------------------------
router.post('/setup', async (req, res, next) => {
  try {
    const { token, email, password, name } = req.body ?? {};

    // Verified but NOT cleared yet. Clearing first would burn the token if
    // account creation then failed, leaving the hospital unable to set up at
    // all.
    if (!await verifySetupToken(req.tenant.id, token)) {
      return res.status(403).json({ error: 'Invalid or already-used setup token' });
    }

    if (!email?.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    const problem = auth.passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });

    const user = await auth.createFirstUser(req.prisma, { email, password, name });

    if (!user) {
      // Someone got there first. Not a failure — a statement of fact.
      await clearSetupToken(req.tenant.id);
      return res.status(410).json({ error: 'Setup has already been completed' });
    }

    // Spent. From here the only way in is a password.
    await clearSetupToken(req.tenant.id);

    // Sign them straight in. No reason to make someone log in immediately
    // after choosing their own password.
    const sessionToken = await auth.startSession(req.prisma, user.id);
    res.cookie(COOKIE_NAME, sessionToken, cookieOptions());

    res.status(201).json({ user: auth.publicUser(user) });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(410).json({ error: 'Setup has already been completed' });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/auth/password   — guarded
//
// Anyone signed in can change their own password. Ends every OTHER session for
// that user, sparing the current one.
// ---------------------------------------------------------------------------
router.patch('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    const problem = auth.passwordProblem(newPassword);
    if (problem) return res.status(400).json({ error: problem });

    const result = await auth.changeOwnPassword(req.prisma, {
      userId: req.user.id,
      sessionId: req.sessionId,
      currentPassword,
      newPassword
    });

    if (result.error === 'wrong-current') {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }
    if (result.error) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json({ ok: true, otherSessionsEnded: result.otherSessionsEnded });
  } catch (err) {
    next(err);
  }
});

export default router;
