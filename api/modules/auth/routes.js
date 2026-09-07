import express from 'express';
import { COOKIE_NAME, cookieOptions, requireAuth } from '../../lib/session.js';
import { verifySetupToken, clearSetupToken, hasSetupToken } from '../../lib/control-plane.js';
import { auditRequest, record, actorFrom, ACTIONS } from '../../lib/audit.js';
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
 * is worse than a slow one.
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
      // Worth recording. A burst of these is what an attempted break-in looks
      // like from the inside, and it is invisible without them.
      await record(req.prisma, {
        ...actorFrom(req),
        action: ACTIONS.LOGIN_LOCKED,
        outcome: 'denied',
        meta: { email: key }
      });

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

      // The attempted email is recorded, and it is a STAFF email, not patient
      // data. It is the whole value of the entry: "someone is trying this
      // account" is the question a failed-login log exists to answer.
      await record(req.prisma, {
        ...actorFrom(req),
        action: ACTIONS.LOGIN_FAILED,
        outcome: 'failed',
        meta: { email: key }
      });

      /*
       * The hospital's NAME is returned alongside the refusal, and it leaks
       * nothing: the caller chose the hostname that selected this hospital,
       * and /api/auth/status already reports the same name without a session.
       *
       * It is here because of a real hour lost to this. Signing in against the
       * wrong hostname resolves to a DIFFERENT HOSPITAL, whose database has
       * never heard of your account — and the honest answer to that is
       * "invalid email or password", which sends you off checking your
       * password instead of your address bar. Saying which hospital just
       * refused you turns that into a glance.
       */
      return res.status(401).json({
        error: 'Invalid email or password',
        hospital: req.tenant.name
      });
    }

    await auth.clearFailures(req.prisma, key);

    const token = await auth.startSession(req.prisma, user.id);
    res.cookie(COOKIE_NAME, token, cookieOptions());

    await record(req.prisma, {
      ...actorFrom(req),
      actorId: user.id,
      actorEmail: user.email,
      action: ACTIONS.LOGIN,
      entity: 'User',
      entityId: user.id
    });

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
    // Read before the session is destroyed, so the log knows who left. Without
    // this the entry would be anonymous, which is exactly the entry nobody can
    // use.
    const session = await auth.whoIs(req.prisma, req.cookies?.[COOKIE_NAME]);

    await auth.endSession(req.prisma, req.cookies?.[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });

    if (session) {
      await record(req.prisma, {
        ...actorFrom(req),
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: ACTIONS.LOGOUT,
        entity: 'User',
        entityId: session.user.id
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me   — guarded
//
// NOT audited. It runs on every page load, and a log where 95% of the rows say
// "someone checked they were still signed in" is a log nobody reads — which
// makes it worse than a smaller one.
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, hospital: req.tenant.name });
});

// ---------------------------------------------------------------------------
// GET /api/auth/status
//
// What the app asks before showing anything. setupAvailable is separate from
// needsSetup on purpose: a hospital with no accounts and no token left is
// stuck, and the app should say so rather than showing a form that cannot
// succeed.
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
// ---------------------------------------------------------------------------
router.post('/setup', async (req, res, next) => {
  try {
    const { token, email, password, name } = req.body ?? {};

    // Verified but NOT cleared yet. Clearing first would burn the token if
    // account creation then failed, leaving the hospital unable to set up.
    if (!await verifySetupToken(req.tenant.id, token)) {
      // The very first thing anyone could do to this hospital, and it failed.
      // If that is someone guessing, this is the only place it will show.
      await record(req.prisma, {
        ...actorFrom(req),
        action: ACTIONS.SETUP_REJECTED,
        outcome: 'denied'
      });

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

    await record(req.prisma, {
      ...actorFrom(req),
      actorId: user.id,
      actorEmail: user.email,
      action: ACTIONS.SETUP_COMPLETED,
      entity: 'User',
      entityId: user.id
    });

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
// Ends every OTHER session for that user, sparing the current one.
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
      // Someone with a valid session who does not know the password. That is
      // what a borrowed workstation looks like, and it is the reason a refused
      // action is worth recording at all.
      await auditRequest(req, {
        action: ACTIONS.PASSWORD_CHANGED,
        outcome: 'denied',
        entity: 'User',
        entityId: req.user.id
      });

      return res.status(403).json({ error: 'Current password is incorrect' });
    }
    if (result.error) {
      return res.status(404).json({ error: 'Account not found' });
    }

    await auditRequest(req, {
      action: ACTIONS.PASSWORD_CHANGED,
      entity: 'User',
      entityId: req.user.id,
      // A count, not a list. How many sessions ended is useful; which devices
      // they were is detail the log does not need.
      meta: { otherSessionsEnded: result.otherSessionsEnded }
    });

    res.json({ ok: true, otherSessionsEnded: result.otherSessionsEnded });
  } catch (err) {
    next(err);
  }
});

export default router;
