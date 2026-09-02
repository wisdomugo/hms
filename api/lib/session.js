import { randomBytes, createHash } from 'node:crypto';

/*
 * Copied from SiteSilo with TWO changes, both noted below.
 *
 * Everything else is untouched, and the important parts are worth restating
 * because they are easy to "simplify" into being wrong:
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
 * SiteSilo used a fixed 7 days, which is right for a CMS one person signs into
 * from their own laptop. It is wrong for a ward computer three nurses share
 * across a shift change, so this is hours and it comes from the environment.
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
 * SiteSilo imports a module-level singleton here. This system has one database
 * PER HOSPITAL, so there is no singleton to import: the client belongs to the
 * request, and the tenant layer in step 2 puts it on req.prisma.
 *
 * Done now rather than in step 2 for one practical reason — it means this file
 * has no dangling import and is valid the moment it lands, so step 2 is purely
 * additive rather than a rewrite of code you have already reviewed.
 *
 * The rule this enforces: no module imports a Prisma singleton. Forget the
 * tenant and you get `undefined` and a stack trace, never another hospital's
 * patients.
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
    include: { user: { select: { id: true, email: true, name: true, role: true } } }
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session;
}

export async function destroySession(prisma, token) {
  if (!token) return;
  await prisma.session.delete({ where: { id: hashToken(token) } }).catch(() => {});
}

export async function requireAuth(req, res, next) {
  // req.prisma is set by the tenant middleware (step 2). If it is missing, the
  // middleware is not mounted — say so plainly rather than throwing a
  // TypeError three frames deeper.
  if (!req.prisma) {
    return next(new Error('req.prisma is not set — resolveTenant must run before requireAuth'));
  }

  const session = await getSession(req.prisma, req.cookies?.[COOKIE_NAME]);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.user = session.user;
  req.sessionId = session.id;   // so a password change can spare this session
  next();
}

/*
 * Kept from SiteSilo as a placeholder, and it is temporary.
 *
 * Two string roles is honest for a CMS. This system has receptionists, triage
 * nurses, doctors, lab scientists, pharmacists, cashiers, records officers, HR
 * and a medical director — with permissions that vary by department and ward.
 *
 * Step 4 replaces this with requirePermission('patient.register') backed by
 * Role and Permission tables. The MIDDLEWARE SHAPE stays exactly as it is
 * here; only what it consults changes.
 */
export function requireOwner(req, res, next) {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can do that' });
  }
  next();
}
