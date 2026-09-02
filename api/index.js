import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storage } from './lib/storage/index.js';

/*
 * STEP 1 — the shell, and deliberately nothing else.
 *
 * No routers are mounted. Everything here is plumbing: the pieces that are
 * miserable to debug LATER, once there is new code to blame for a failure
 * that is actually a proxy setting or a missing environment variable.
 *
 * The two marked insertion points below are where step 2 and step 3 attach.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIST = path.join(__dirname, '..', 'app', 'dist');

const STARTED_AT = new Date().toISOString();

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Caddy in production, so req.ip and req.protocol must reflect the real
// client rather than the proxy. Not load-bearing today. It becomes so the
// moment anything rate-limits by IP, and the moment the audit log starts
// recording a source address — which is step 4.
app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------------------
// STEP 2 INSERTS THE TENANT SEAM HERE:
//
//   app.use(resolveTenant);
//
// Hostname -> tenant -> req.tenant and req.prisma. It must run BEFORE anything
// that touches the database, including auth, because sessions live in the
// tenant's own database rather than a shared one.
//
// The rule that comes with it: no module ever imports a Prisma singleton.
// Every module reads req.prisma. Forgetting produces `undefined` and a stack
// trace, not another hospital's patients.
// ---------------------------------------------------------------------------

// Optional CORS — only active when the staff app is served from another origin.
if (process.env.APP_ORIGIN) {
  const { default: cors } = await import('cors');
  app.use(cors({ origin: process.env.APP_ORIGIN, credentials: true }));
}

// Uploaded files are served directly. Only mounted for drivers that keep files
// on this machine; with S3 the files are not here at all and storage.root is
// undefined.
if (storage.root) {
  app.use('/uploads', express.static(storage.root, {
    maxAge: '30d',
    // Stop a browser second-guessing the declared content type.
    setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff')
  }));
}

/*
 * Health.
 *
 * More than a liveness ping, and worth getting the shape right now.
 *
 * With one instance per hospital, this endpoint is the only way to answer
 * "what is actually running out there" without SSH-ing into someone's server.
 * A fleet script polls every install and prints a table: version, migration
 * state, uptime. `migrations` and `commit` stay null until step 2 and the
 * deploy script fill them in — the shape is fixed now so the fleet script
 * never has to change.
 *
 * Registered on two paths on purpose. /health is what a load balancer and the
 * fleet script hit. /api/health is what the staff app hits, because the Vite
 * dev proxy only forwards /api and /uploads.
 */
function health(req, res) {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    startedAt: STARTED_AT,
    node: process.version,
    env: process.env.NODE_ENV ?? 'development',
    commit: process.env.GIT_COMMIT ?? null,   // set by deploy.sh
    migrations: null                          // step 2
  });
}

app.get('/health', health);
app.get('/api/health', health);

// ---------------------------------------------------------------------------
// STEP 3 ONWARDS MOUNT ROUTERS HERE:
//
//   app.use('/api/auth',     authRouter);              // mixed — guarded inside
//   app.use('/api/patients', requireAuth, patientsRouter);
//
// Guard at the mount point wherever the whole router is protected. Where a
// router is mixed, guard inside it and say in a comment which route is public
// and why — that comment is what stops the exception being copied by accident.
// ---------------------------------------------------------------------------

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
// /app/patients/42 is not a file on disk. Without the splat route, opening or
// refreshing such a URL returns 404 even though navigating to it from inside
// the app works perfectly.
// ---------------------------------------------------------------------------
if (process.env.SERVE_STATIC === 'true') {
  app.use('/app', express.static(APP_DIST));
  app.get('/app/*splat', (req, res) => {
    res.sendFile(path.join(APP_DIST, 'index.html'));
  });

  // Nothing lives at the root yet. The patient portal will, eventually. Until
  // then send people to the staff app rather than an unexplained 404.
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

app.use((err, req, res, next) => {
  // NEVER log req.body here. The moment clinical routes exist, that would
  // print patient details into a log file — and log files get copied around,
  // emailed to support, and pasted into chat. Method, path and the error only.
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
