import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storage } from './lib/storage/index.js';
import { resolveTenant, appliedMigrationCount, expectedMigrationCount } from './lib/tenancy.js';
import { serveUpload } from './lib/uploads-route.js';
import { requireAuth, requirePasswordCurrent } from './lib/session.js';
import { controlPlaneStatus } from './lib/control-plane.js';

import authRouter from './modules/auth/routes.js';
import auditRouter from './modules/audit/routes.js';
import patientsRouter, { worklist, todaySummary } from './modules/patients/routes.js';
import usersRouter from './modules/auth/users.js';

/*
 * MILESTONE 03 — the shell, the tenant seam, and authentication.
 *
 * The chain now runs end to end: hostname to hospital to database to session to
 * user. Clinical modules attach at the marked point below.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIST = path.join(__dirname, '..', 'app', 'dist');

const STARTED_AT = new Date().toISOString();

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Caddy in production, so req.ip and req.protocol reflect the real
// client rather than the proxy. Load-bearing: resolveTenant reads req.hostname,
// which honours X-Forwarded-Host only because of this line.
app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());

// Optional CORS — only active when the staff app is served from another origin.
if (process.env.APP_ORIGIN) {
  const { default: cors } = await import('cors');
  app.use(cors({ origin: process.env.APP_ORIGIN, credentials: true }));
}

/*
 * Uploaded files — clinical documents, and now properly guarded.
 *
 * Until milestone 05b this was express.static pointed at one folder: no
 * authentication, and no tie between a file and a hospital. Harmless only
 * because nothing wrote there. 05b starts writing, so 05b closes it.
 *
 * Three changes, all in lib/uploads-route.js:
 *   - every storage key now begins with the hospital's slug
 *   - the handler refuses any path outside the requesting hospital's prefix
 *   - it needs a session, because these are scanned ID cards and referral
 *     letters, not website images
 *
 * resolveTenant is mounted here as well as on /api, because the handler cannot
 * check a prefix without knowing which hospital is asking.
 */
app.use('/uploads', resolveTenant, requireAuth, serveUpload);

/*
 * Health — process level, ABOVE the tenant layer.
 *
 * Deliberately not tenant-resolved. A fleet script polling fifty installs needs
 * an answer without knowing or caring which hospital a hostname belongs to, and
 * needs one even when the control plane is the thing that is broken.
 */
app.get('/health', async (req, res) => {
  const control = await controlPlaneStatus();

  res.json({
    status: control.reachable ? 'ok' : 'degraded',
    uptime: process.uptime(),
    startedAt: STARTED_AT,
    node: process.version,
    env: process.env.NODE_ENV ?? 'development',
    commit: process.env.GIT_COMMIT ?? null,   // set by deploy.sh
    controlPlane: control
  });
});

// ---------------------------------------------------------------------------
// THE TENANT SEAM.
//
// Scoped to /api, and mounted before everything that touches hospital data —
// including authentication, because sessions live in the hospital's own
// database and there is nothing to authenticate against until the hospital is
// known.
//
// From here down, req.prisma is the hospital's database client and req.tenant
// says which hospital.
//
// The rule this exists to enforce: no module imports a Prisma client. Every
// module reads req.prisma. Forgetting produces `undefined` and a stack trace,
// never another hospital's patients.
// ---------------------------------------------------------------------------
app.use('/api', resolveTenant);

/*
 * Health — hospital level.
 *
 * Adds what only makes sense once a hospital is known: which one, how it was
 * resolved, and how many migrations its database has actually had applied. That
 * last number answers "is this installation on the current version" without
 * SSH access.
 *
 * It is also what the staff app calls, because the Vite development proxy
 * forwards /api and /uploads and nothing else.
 */
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    startedAt: STARTED_AT,
    node: process.version,
    env: process.env.NODE_ENV ?? 'development',
    commit: process.env.GIT_COMMIT ?? null,
    tenant: req.tenant,
    migrations: {
      applied: await appliedMigrationCount(req.prisma),
      expected: expectedMigrationCount()
    }
  });
});

// ---------------------------------------------------------------------------
// Modules.
//
// Guard at the mount point wherever a whole router is protected. /auth is
// MIXED — most of it must be reachable without a session, which is what it is
// for — so it guards /me and /password individually, and says so at each route.
//
// Milestone 05 adds:
//   app.use('/api/patients', requireAuth, patientsRouter);
// ---------------------------------------------------------------------------
app.use('/api/auth', authRouter);

// Staff administration. Owner-only, guarded inside the router. Deliberately
// NOT behind requirePasswordCurrent: an owner on a temporary password is the
// person who most needs it.
app.use('/api/users', usersRouter);

// Read-only, and guarded inside: signed in, then owner-only. Milestone 06
// narrows that to requirePermission('audit.read') — a permission very few roles
// should carry, since the log names who did what.
app.use('/api/audit', requireAuth, requirePasswordCurrent, auditRouter);

// Module 01 — Patient Registration. Guarded at the mount point: there is no
// public patient endpoint and there never will be.
app.use('/api/patients', requireAuth, requirePasswordCurrent, patientsRouter);

// The reconciliation worklist. Its own path rather than /api/patients/... —
// it is a queue of work, not a property of any one patient, and modules 03 and
// 05 will hang their own worklists beside it.
app.get('/api/worklists/incomplete', requireAuth, requirePasswordCurrent, worklist);

// The landing screen's figures. Its own path rather than under /api/patients
// because it is about the day, not about a patient, and later modules will add
// their own counts to it rather than to the patient module.
app.get('/api/summary/today', requireAuth, requirePasswordCurrent, todaySummary);

// API 404 — scoped to /api ONLY.
//
// A blanket catch-all here would swallow every front-end route and answer it
// with JSON, so unknown app paths must fall through to the SPA handler below.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// ---------------------------------------------------------------------------
// Static serving of the built staff app.
//
// Production only. In development Vite serves it, and its /api and /uploads
// proxies point back here.
//
// THE SPA FALLBACK is the important part. The app is a single index.html;
// /app/account is not a file on disk. Without the splat route, opening or
// refreshing such a URL returns 404 even though navigating to it from inside
// the app works perfectly.
// ---------------------------------------------------------------------------
if (process.env.SERVE_STATIC === 'true') {
  app.use('/app', express.static(APP_DIST));
  app.get('/app/*splat', (req, res) => {
    res.sendFile(path.join(APP_DIST, 'index.html'));
  });

  // Nothing lives at the root yet. The patient portal will, eventually.
  app.get('/', (req, res) => res.redirect('/app/'));
}

// Multer rejects oversized or disallowed files by throwing. Without this, the
// generic handler below would turn a user mistake into a 500 with no useful
// message. 413 and 415 are the correct codes, and they tell the UI what to say.
app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large' });
  }
  if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Send exactly one file, in the "file" field' });
  }
  if (err?.message?.startsWith('Unsupported file type')) {
    return res.status(415).json({ error: err.message });
  }
  next(err);
});

// ---------------------------------------------------------------------------
// A DATABASE THAT IS BEHIND THE CODE.
//
// Prisma raises P2021 (no such table) and P2022 (no such column) when the
// generated client knows about something the database has not been given yet.
// It means one thing and one thing only: a migration has not been applied to
// this hospital.
//
// Without this, that arrives as a bare 500 and "Internal server error" — the
// same shape as a null dereference, a bad query, or anything else. It is the
// database twin of the stale-client problem in lib/tenancy.js, and it deserves
// the same treatment: say what happened and name the command that fixes it.
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err?.code !== 'P2021' && err?.code !== 'P2022') return next(err);

  const missing = err.meta?.column ?? err.meta?.table ?? 'something';
  const who = req.tenant?.slug ?? 'this hospital';

  console.error(
    `\n  ${who}'s database is behind the code.\n` +
    `  Prisma ${err.code}: ${missing} does not exist there, but the generated\n` +
    `  client expects it. A migration has not been applied.\n\n` +
    `  Fix with:  cd api && npm run migrate:all\n`
  );

  res.status(500).json({
    error: 'This hospital\'s database is behind the running code',
    detail: `${missing} is missing. Run: npm run migrate:all`
  });
});

app.use((err, req, res, next) => {
  // NEVER log req.body here. Clinical routes are one milestone away, and that
  // would print patient details into a log file — and log files get copied
  // around, emailed to support, and pasted into chat.
  //
  // The tenant slug IS logged: on a shared server, an error without it cannot
  // be traced to a hospital.
  const who = req.tenant?.slug ?? '-';
  console.error(`[${who}] [${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
