import { randomInt } from 'node:crypto';
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
  role: user.role,
  // Drives the forced password screen in the app. Not sensitive: it says the
  // account must choose a new password, not what the current one is.
  mustChangePassword: user.mustChangePassword ?? false
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
    data: {
      passwordHash: await hashPassword(newPassword),
      // Whatever brought them here, they have now chosen a password nobody
      // else has heard. This is the only place the flag is cleared.
      mustChangePassword: false
    }
  });

  const { count } = await prisma.session.deleteMany({
    where: { userId, NOT: { id: sessionId } }
  });

  return { otherSessionsEnded: count };
}

// ---------------------------------------------------------------------------
// Password recovery
//
// Two callers, one mechanism:
//
//   the Staff screen      the owner resets a member of staff who is standing
//                         in front of them
//   set-password.mjs      you reset the owner, over SSH, because there is
//                         nobody in the hospital who can
//
// Both issue a TEMPORARY password and set mustChangePassword. Neither can read
// the old one back, because only a scrypt hash was ever stored.
// ---------------------------------------------------------------------------

/*
 * Words, not characters.
 *
 * This password gets spoken down a phone line to somebody who is writing it on
 * a sticky note. "cliff-orbit-9214" survives that journey; "xK9#mP2$vL" does
 * not, and the failure mode is three phone calls and a person who ends up
 * choosing "password1" out of exhaustion.
 *
 * The list avoids anything that sounds like anything else aloud, and there are
 * no letters that could be a digit. Two words plus four digits from a list of
 * 64 is about 34 bits, which is far too weak to leave in place and entirely
 * adequate for something that must be changed at the next sign-in and cannot
 * be guessed at more than five times in ten minutes.
 */
const WORDS = [
  'anchor', 'basket', 'candle', 'dolphin', 'ember', 'falcon', 'garden', 'harbour',
  'island', 'jacket', 'kettle', 'lantern', 'meadow', 'nutmeg', 'orbit', 'pebble',
  'quiver', 'ribbon', 'saddle', 'timber', 'umbrella', 'velvet', 'walnut', 'yonder',
  'almond', 'bridge', 'cactus', 'domino', 'engine', 'forest', 'gallop', 'hammer',
  'indigo', 'jungle', 'kernel', 'ladder', 'mantle', 'noodle', 'oyster', 'parcel',
  'quarry', 'rocket', 'summit', 'tunnel', 'update', 'vessel', 'window', 'zigzag',
  'apricot', 'bonfire', 'compass', 'diamond', 'eclipse', 'fossil', 'granite', 'hazel',
  'iceberg', 'juniper', 'kiwi', 'lagoon', 'marble', 'nectar', 'opal', 'prairie'
];

export function temporaryPassword() {
  const pick = () => WORDS[randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${String(randomInt(10000)).padStart(4, '0')}`;
}

/**
 * Issue a temporary password for somebody else's account.
 *
 * EVERY session for that user ends, without exception — including the one they
 * are sitting in front of. A reset is what you do when an account may be in the
 * wrong hands, so it has to evict whoever is currently holding it. This is the
 * one difference from changeOwnPassword, which deliberately spares the caller's
 * own session.
 *
 * Returns the plaintext ONCE. It is never stored and cannot be shown again.
 */
export async function issueTemporaryPassword(prisma, { userId }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: 'notfound' };

  const password = temporaryPassword();

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: true
    }
  });

  const { count } = await prisma.session.deleteMany({ where: { userId } });

  // The throttle is cleared too. Somebody who has just been given a new
  // password should not meet a lockout earned by the failed attempts that led
  // to them asking for one.
  await prisma.loginThrottle.delete({ where: { email: user.email } }).catch(() => {});

  return { user, password, sessionsEnded: count };
}

export const ROLES = ['owner', 'staff'];

/**
 * Add an account.
 *
 * NO PASSWORD IS CHOSEN HERE, by anybody. The account is created with a
 * temporary one and mustChangePassword set, exactly as a reset does — so the
 * owner reads it to the person, and the person chooses their own before they
 * can do anything at all.
 *
 * The alternative — letting the owner type a password for someone else — means
 * the owner knows a password that the audit log will attribute solely to that
 * member of staff. In a hospital, where the log is the record of who opened
 * whose file, that is not a small thing.
 *
 * Roles are 'owner' or 'staff' until milestone 07, and a hospital SHOULD have
 * more than one owner: an owner is the only account that can rescue the others,
 * so exactly one of them is a single point of failure with a person's memory
 * attached to it.
 */
export async function createUser(prisma, { email, name, role }) {
  const clean = String(email ?? '').toLowerCase().trim();

  if (!clean || !clean.includes('@')) return { error: 'bad-email' };
  if (!ROLES.includes(role)) return { error: 'bad-role' };

  const existing = await prisma.user.findUnique({ where: { email: clean } });
  if (existing) return { error: 'taken' };

  const password = temporaryPassword();

  try {
    const user = await prisma.user.create({
      data: {
        email: clean,
        name: name?.trim() || null,
        role,
        passwordHash: await hashPassword(password),
        mustChangePassword: true
      }
    });
    return { user, password };
  } catch (err) {
    // Two owners adding the same address at once. The unique index is the
    // thing that actually decides it; the check above only makes the common
    // case a clean message instead of a constraint violation.
    if (err?.code === 'P2002') return { error: 'taken' };
    throw err;
  }
}

/**
 * Every account in this hospital, for the Staff screen.
 *
 * No password material of any kind, not even the hash. A list endpoint that
 * returns hashes is how an offline cracking attempt starts.
 */
export async function listUsers(prisma) {
  return prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
    select: {
      id: true, email: true, name: true, role: true,
      isActive: true, mustChangePassword: true, createdAt: true
    }
  });
}
