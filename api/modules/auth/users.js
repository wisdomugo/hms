import express from 'express';
import { requireAuth, requireOwner } from '../../lib/session.js';
import { auditRequest, ACTIONS } from '../../lib/audit.js';
import * as auth from './service.js';

/*
 * Staff administration.
 *
 * Only one thing lives here for now — issuing a temporary password — because
 * only one thing was blocking deployment. Creating accounts, deactivating them
 * and assigning roles arrive together in milestone 07, when there are roles for
 * them to assign.
 *
 * GUARDED BY requireOwner, which is the placeholder from lib/session.js. When
 * milestone 07 lands it becomes requirePermission('user.manage') and nothing
 * else here changes — that is the point of the middleware keeping its shape.
 *
 * requirePasswordCurrent is deliberately NOT mounted. An owner who is himself
 * on a temporary password is exactly the person who most needs this screen, and
 * locking him out of it would recreate the problem it exists to solve.
 */
const router = express.Router();

router.use(requireAuth, requireOwner);

// Nothing here may be cached. A stale list of who has access is worse than a
// slow one.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------------------
// GET /api/users
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const users = await auth.listUsers(req.prisma);

    // Audited. Reading the list of who can get into a hospital's records is a
    // reasonable thing for an owner to do and a reasonable thing to have a
    // record of, and unlike patient search this happens rarely enough that the
    // rows stay meaningful.
    await auditRequest(req, {
      action: ACTIONS.USERS_LISTED,
      meta: { count: users.length }
    });

    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users
//
// Creates an account and returns its temporary password ONCE, in the same
// shape as a reset — because from the new person's point of view it is the
// same thing: a password somebody else knows, which they must replace before
// they can do anything.
// ---------------------------------------------------------------------------
router.post('/', async (req, res, next) => {
  try {
    const { email, name, role } = req.body ?? {};

    const result = await auth.createUser(req.prisma, {
      email,
      name,
      // Defaulting to 'staff' rather than requiring the field: the safe value
      // should be the one you get by forgetting.
      role: role ?? 'staff'
    });

    if (result.error === 'bad-email') {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (result.error === 'bad-role') {
      return res.status(400).json({
        error: `Role must be one of: ${auth.ROLES.join(', ')}`
      });
    }
    if (result.error === 'taken') {
      // 409, not 400. Nothing about the request was malformed — the account
      // already exists, and the caller probably wants to reset it instead.
      return res.status(409).json({
        error: 'An account with that email already exists here',
        detail: 'If they have lost their password, reset it rather than adding them again.'
      });
    }

    await auditRequest(req, {
      action: ACTIONS.USER_CREATED,
      entity: 'User',
      entityId: result.user.id,
      meta: { targetEmail: result.user.email, role: result.user.role }
    });

    res.status(201).json({
      password: result.password,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role
      },
      sessionsEnded: 0
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/:id/reset-password
//
// Returns the new password ONCE, in the response body. It is not stored, not
// logged, and cannot be retrieved again — losing it means issuing another.
// ---------------------------------------------------------------------------
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'User id must be an integer' });
    }

    /*
     * You cannot reset your own password here.
     *
     * Not a safety rail — a signpost. Someone who knows their password should
     * use Account, which asks for the current one and spares their session.
     * Doing it here would end every session including the one they are using,
     * so they would be signed out mid-action by a button that looked helpful.
     */
    if (id === req.user.id) {
      return res.status(400).json({
        error: 'Use Account to change your own password',
        detail: 'Resetting from here would end the session you are using.'
      });
    }

    const result = await auth.issueTemporaryPassword(req.prisma, { userId: id });

    if (result.error === 'notfound') {
      return res.status(404).json({ error: 'No such user' });
    }

    await auditRequest(req, {
      action: ACTIONS.PASSWORD_RESET_ISSUED,
      entity: 'User',
      entityId: id,
      // Who it was done TO. The actor is attached by auditRequest. The password
      // is not here and must never be.
      meta: { targetEmail: result.user.email, sessionsEnded: result.sessionsEnded }
    });

    res.json({
      password: result.password,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      sessionsEnded: result.sessionsEnded
    });
  } catch (err) {
    next(err);
  }
});

export default router;
