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
 * CHANGE 1 — lifetime.
 *
 * A fixed seven days suits a CMS one person signs into from their own laptop.
 * It is wrong for a ward computer three nurses share across a shift change, so
 * this is hours and it comes from the environment.
 */
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;

const hashToken = token => createHash('sha256').update(token).digest('hex');

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: SESSION_MS
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
      expiresAt: new Date(Date.now() + SESSION_MS)
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
        select: { id: true, email: true, name: true, role: true, isActive: true }
      }
    }
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  /*
   * CHANGE 3 — a deactivated account has no valid session.
   *
   * Checked on every request rather than only at login. Staff leave, and when
   * someone is deactivated the expectation is that they lose access now, not
   * whenever their twelve-hour session happens to expire.
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
      role: session.user.role
    };
    req.sessionId = session.id;   // so a password change can spare this session

    next();
  } catch (err) {
    next(err);
  }
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
