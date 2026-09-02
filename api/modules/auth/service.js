import { hashPassword, verifyPassword } from '../../lib/password.js';
import { createSession, destroySession, getSession } from '../../lib/session.js';

/*
 * Business rules for authentication.
 *
 * Routes handle HTTP — parsing, status codes, cookies. This handles the rules,
 * and takes `prisma` as its first argument because every one of these runs
 * against a specific hospital's database.
 *
 * Audit calls live in routes.js rather than here. That is a deliberate choice
 * and worth stating: an audit entry needs the IP address and the user agent,
 * which are properties of the REQUEST, not of the rule. Pushing them down here
 * would mean threading req through every function to serve the log.
 */

const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1000;
const MIN_PASSWORD = 10;

// ---------------------------------------------------------------------------
// Throttling
//
// In the hospital's own database, so it is per hospital automatically:
// hammering one hospital's login cannot lock an account at another that
// happens to share an email address.
// ---------------------------------------------------------------------------

function windowExpired(row) {
  return Date.now() - row.windowStart.getTime() > WINDOW_MS;
}

export async function isLockedOut(prisma, email) {
  const row = await prisma.loginThrottle.findUnique({ where: { email } });
  if (!row) return false;

  if (windowExpired(row)) {
    await prisma.loginThrottle.delete({ where: { email } }).catch(() => {});
    return false;
  }

  return row.failures >= MAX_FAILURES;
}

export async function recordFailure(prisma, email) {
  const row = await prisma.loginThrottle.findUnique({ where: { email } });

  // A new window, either because there was none or because the old one aged
  // out. Written as an upsert so two simultaneous failures cannot both decide
  // to create the row.
  if (!row || windowExpired(row)) {
    await prisma.loginThrottle.upsert({
      where: { email },
      create: { email, failures: 1, windowStart: new Date() },
      update: { failures: 1, windowStart: new Date() }
    });
    return;
  }

  await prisma.loginThrottle.update({
    where: { email },
    data: { failures: { increment: 1 } }
  });
}

export async function clearFailures(prisma, email) {
  await prisma.loginThrottle.deleteMany({ where: { email } });
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export const publicUser = user => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role
});

/**
 * Verify an email and password.
 *
 * Returns the user, or null. Deliberately makes no distinction between an
 * unknown email, a wrong password and a deactivated account — the caller emits
 * one message for all three, because three different messages turn this into a
 * way to discover which emails are real.
 */
export async function authenticate(prisma, email, password) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  if (!user.isActive) return null;

  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

/**
 * Who does this token belong to, without requiring a session middleware?
 *
 * Exists for logout. The session has to be read BEFORE it is destroyed, or the
 * audit entry is anonymous — and an anonymous "somebody signed out" is exactly
 * the entry nobody can use.
 */
export async function whoIs(prisma, token) {
  return getSession(prisma, token);
}

export async function startSession(prisma, userId) {
  return createSession(prisma, userId);
}

export async function endSession(prisma, token) {
  return destroySession(prisma, token);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export function passwordProblem(password) {
  if (!password || password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters`;
  }
  return null;
}

/**
 * Create the FIRST account for a hospital.
 *
 * The count and the create share a transaction, so two simultaneous requests
 * cannot both see an empty table and both create an owner.
 *
 * Returns null when someone got there first, which the route turns into a 410 —
 * "this has already happened" rather than "this failed".
 */
export async function createFirstUser(prisma, { email, password, name }) {
  return prisma.$transaction(async tx => {
    if (await tx.user.count() > 0) return null;

    return tx.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash: await hashPassword(password),
        name: name?.trim() || null,
        role: 'owner'
      }
    });
  });
}

export async function needsSetup(prisma) {
  return (await prisma.user.count()) === 0;
}

/**
 * Change your own password.
 *
 * Every other session for this user ends. A stolen cookie must not survive the
 * action taken to lock the attacker out — which is the whole reason requireAuth
 * bothers to record req.sessionId.
 */
export async function changeOwnPassword(prisma, { userId, sessionId, currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: 'notfound' };

  if (!await verifyPassword(currentPassword, user.passwordHash)) {
    return { error: 'wrong-current' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) }
  });

  const { count } = await prisma.session.deleteMany({
    where: { userId, NOT: { id: sessionId } }
  });

  return { otherSessionsEnded: count };
}
