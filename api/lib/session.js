import { randomBytes, createHash } from 'node:crypto';

/*
 * Sessions.
 *
 * Originally SiteSilo's, and now diverged in three places — all commented
 * below. The parts that did not change are the parts that are easy to
 * "simplify" into being wrong:
 *
 *   - The token in the cookie is random and opaque. Only its SHA-256 lands in
 *     the database. Someone who reads a database dump cannot forge a session.
 *   - Cookie behaviour comes entirely from the environment, so localhost,
 *     same-origin and cross-subdomain all work from identical code.
 *   - requireAuth attaches req.sessionId as well as req.user, so a password
 *     change can end every OTHER session while sparing the current one.
 */

export const COOKIE_NAME = 'hms_session';

/*
 * CHANGE 1 — lifetime, and it is idle-based rather than a fixed clock.
 *
 * A fixed seven days suits a CMS one person signs into from their own laptop.
 * A fixed twelve hours, which this used to be, is not much better for a ward:
 * it logs out the clerk who is mid-registration at hour twelve, and it leaves
 * the computer at the nurses' station signed in all afternoon after whoever
 * opened it went home.
 *
 * So there are two limits, and they answer different questions:
 *
 *   IDLE   — how long an UNUSED session survives. This is the one that fires in
 *            practice. A busy person never meets it; an abandoned screen always
 *            does.
 *   MAX    — the absolute ceiling, regardless of activity. Without it a session
 *            kept warm by a browser tab polling in the background would live
 *            forever, which is the hole idle timeouts are famous for.
 */
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 120);
const IDLE_MS = IDLE_MINUTES * 60 * 1000;

const MAX_HOURS = Number(process.env.SESSION_MAX_HOURS || 24);
const MAX_MS = MAX_HOURS * 60 * 60 * 1000;

/*
 * How stale lastSeenAt is allowed to get before we write it again.
 *
 * Stamping it on literally every request would put a database write on the
 * read path of every page load — the same cost the deactivated-account check
 * below deliberately refuses to pay. Writing at most once a minute makes the
 * idle timeout accurate to within a minute, which for a two-hour window is
 * accuracy nobody can perceive, at a fraction of the writes.
 */
const TOUCH_AFTER_MS = 60 * 1000;

const hashToken = token => createHash('sha256').update(token).digest('hex');

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/',
    // The absolute ceiling, not the idle window. The cookie cannot slide itself
    // and the server is the thing that decides whether a session is still
    // alive, so a cookie that outlives its session is harmless — it is
    // presented, rejected, and cleared.
    maxAge: MAX_MS
  };
}

/*
 * CHANGE 2 — prisma is passed in, not imported.
 *
 * One database per hospital means there is no singleton to import: the client
 * belongs to the request, and the tenant layer puts it on req.prisma.
 *
 * The rule this enforces: no module imports a Prisma client. Forget the tenant
 * and you get `undefined` and a stack trace, never another hospital's patients.
 */

export async function createSession(prisma, userId) {
  const token = randomBytes(32).toString('hex');
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + MAX_MS),
      lastSeenAt: new Date()
    }
  });
  return token;
}

export async function getSession(prisma, token) {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: {
      user: {
        select: {
          id: true, email: true, name: true, role: true,
          isActive: true, mustChangePassword: true
        }
      }
    }
  });

  if (!session) return null;

  const now = Date.now();

  // The absolute ceiling.
  if (session.expiresAt.getTime() < now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  /*
   * The idle window — the limit that actually fires.
   *
   * The row is deleted rather than left to expire, because unlike the ceiling
   * this one is reached while the person is still holding a valid-looking
   * cookie, and the next request should not have to work it out again.
   */
  const idleFor = now - session.lastSeenAt.getTime();

  if (idleFor > IDLE_MS) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  /*
   * Stamp it, but not on every request. See TOUCH_AFTER_MS above.
   *
   * Not awaited: the value being written is already reflected in the decision
   * this request just made, so nothing downstream reads it, and making every
   * page load wait for a write to land would defeat the point of throttling it.
   * A failure here costs at most one minute of idle accuracy.
   */
  if (idleFor > TOUCH_AFTER_MS) {
    prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } })
      .catch(() => {});
  }

  /*
   * CHANGE 3 — a deactivated account has no valid session.
   *
   * Checked on every request rather than only at login. Staff leave, and when
   * someone is deactivated the expectation is that they lose access now, not
   * whenever their session happens to fall idle.
   *
   * The session row is left in place: it will expire on its own, and deleting
   * it here would mean a read path doing writes on every request.
   */
  if (!session.user.isActive) return null;

  return session;
}

export async function destroySession(prisma, token) {
  if (!token) return;
  await prisma.session.delete({ where: { id: hashToken(token) } }).catch(() => {});
}

export async function requireAuth(req, res, next) {
  try {
    // Set by the tenant middleware. If it is missing, that middleware is not
    // mounted — say so plainly rather than throwing a TypeError three frames
    // deeper.
    if (!req.prisma) {
      return next(new Error('req.prisma is not set — resolveTenant must run before requireAuth'));
    }

    const session = await getSession(req.prisma, req.cookies?.[COOKIE_NAME]);
    if (!session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      mustChangePassword: session.user.mustChangePassword ?? false
    };
    req.sessionId = session.id;   // so a password change can spare this session

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Refuse everything except choosing a new password, while one is owed.
 *
 * WHY A SEPARATE MIDDLEWARE rather than a check inside requireAuth: /auth/me
 * and /auth/password must stay reachable, or the app cannot find out that a
 * password is owed and cannot let the person pay it. So requireAuth stays a
 * pure "who are you", and this is mounted on the routers holding hospital data.
 *
 * The 403 carries mustChangePassword so a client that has drifted out of step
 * — a tab left open across a reset, say — shows the password screen rather
 * than reporting a permissions failure it cannot explain.
 */
export function requirePasswordCurrent(req, res, next) {
  if (!req.user?.mustChangePassword) return next();

  res.status(403).json({
    error: 'Choose a new password before continuing',
    mustChangePassword: true
  });
}

/*
 * PLACEHOLDER, and temporary.
 *
 * Two string roles is not what a hospital needs. Milestone 04 replaces this
 * with requirePermission('patient.register') backed by Role and Permission
 * tables. The middleware SHAPE stays exactly as it is here; only what it
 * consults changes, which is why call sites will not have to move.
 */
export function requireOwner(req, res, next) {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can do that' });
  }
  next();
}
