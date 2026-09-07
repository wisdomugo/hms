import { readdirSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { findTenantByHost, findTenantBySlug } from './control-plane.js';

/*
 * THE TENANT SEAM.
 *
 * One database per hospital. This module turns an incoming request into the
 * right Prisma client and puts it on req.prisma, which is the only way any
 * module is allowed to reach hospital data.
 *
 * Why this design rather than a tenantId column on every table: forget the
 * tenant filter in that design and the system silently serves one hospital
 * another hospital's patient records. Forget req.prisma here and you get
 * `undefined` and a stack trace on the first call. The failure mode of
 * forgetting is a crash rather than a leak, and for patient data that
 * difference is the whole argument.
 */

/*
 * Deliberately small.
 *
 * Prisma's default pool multiplied by fifty hospitals would ask Postgres for
 * several hundred connections against a default max_connections of 100. Three
 * per hospital is generous for the request volume one hospital produces, and
 * PgBouncer goes in front once this is past a dozen tenants.
 *
 * Set now rather than discovered at hospital fifteen, when the symptom would be
 * intermittent "too many clients" errors under load.
 */
const TENANT_POOL_MAX = Number(process.env.TENANT_POOL_MAX || 3);

// databaseUrl -> PrismaClient. Keyed by URL rather than tenant id so that
// changing a hospital's connection string produces a new client rather than
// silently reusing the old one. (The superseded client stays in the map until
// restart; that is a slow leak, and one that only occurs when an operator edits
// a connection string, so it is left alone deliberately.)
const clients = new Map();

/*
 * A canary against a STALE GENERATED CLIENT.
 *
 * `prisma migrate dev` creates and applies a migration but does not reliably
 * regenerate the client here — the control-plane script does its own generate,
 * the hospital schema has no equivalent. When that happens the API starts
 * perfectly and then every query fails with
 *
 *   TypeError: Cannot read properties of undefined (reading 'count')
 *
 * three frames deep in a service, naming nothing useful. The database is fine;
 * the client simply does not know the model exists.
 *
 * Checked once per tenant, when the client is built. Not an exhaustive list —
 * a canary. If auth's models are missing, everything after them is too.
 */
const CANARY_MODELS = ['user', 'session'];

/*
 * The same check one level down: a FIELD the client should know about.
 *
 * The model check above catches a client generated before a table existed. It
 * cannot catch the commoner half of the problem — a client that knows Session
 * perfectly well but has never heard of Session.lastSeenAt, because the schema
 * gained a column rather than a table. That client passes every check here,
 * starts cleanly, and then fails on the one query that uses the new field:
 *
 *   Unknown argument `lastSeenAt`. Available options are listed in green.
 *
 * which arrives at the browser as a bare 500 during login, with the database
 * entirely up to date and nothing on disk out of place. It happens most often
 * when the API process was already running while the client was regenerated:
 * the files on disk are correct, and the process is holding the old ones.
 *
 * Add an entry here when a migration adds a field to one of these models. It
 * is a tripwire, not a validator — one field per model is enough, because a
 * client that missed one regeneration missed all of it.
 */
const CANARY_FIELDS = { session: 'lastSeenAt' };

function assertClientIsCurrent(client) {
  const missing = CANARY_MODELS.filter(name => !client[name]);

  if (missing.length > 0) {
    throw new Error(
      `The generated Prisma client is missing: ${missing.join(', ')}.\n` +
      'prisma/schema.prisma declares models the client does not know about, ' +
      'which means it was not regenerated after the schema changed. The database ' +
      'is almost certainly fine.\n' +
      'Fix with:  cd api && npm run generate'
    );
  }

  for (const [model, field] of Object.entries(CANARY_FIELDS)) {
    const known = client[model]?.fields;

    // No `fields` map means this Prisma version does not expose one. Skip
    // rather than invent a failure: a canary that cries wolf gets deleted.
    if (!known || field in known) continue;

    throw new Error(
      `The generated Prisma client's ${model} model has no "${field}" field.\n` +
      'The client is older than prisma/schema.prisma. The database is almost\n' +
      'certainly fine; the client simply predates the column.\n\n' +
      'Fix with:  cd api && npm run generate\n' +
      'Then STOP the API and start it again. A running process keeps the client\n' +
      'it loaded at startup, so regenerating underneath it changes nothing until\n' +
      'it restarts.'
    );
  }
}

export function getPrisma(tenant) {
  const existing = clients.get(tenant.databaseUrl);
  if (existing) return existing;

  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: tenant.databaseUrl,
      max: TENANT_POOL_MAX
    })
  });

  assertClientIsCurrent(client);

  clients.set(tenant.databaseUrl, client);
  return client;
}

/**
 * Express middleware. Mounted on /api in index.js, before authentication —
 * sessions live in the hospital's own database, so there is nothing to
 * authenticate against until this has run.
 */
export async function resolveTenant(req, res, next) {
  try {
    let tenant = null;
    let via = null;

    /*
     * Development-only override, so one localhost can exercise several
     * hospitals without touching DNS or the hosts file.
     *
     * Gated on NODE_ENV so it can never become a way to switch hospitals on a
     * real server by setting a header. That gate is the whole reason this is
     * safe to have at all.
     */
    if (process.env.NODE_ENV !== 'production') {
      const slug = req.get('X-Tenant');
      if (slug) {
        tenant = await findTenantBySlug(slug);
        if (tenant) via = 'header';
      }
    }

    /*
     * The production path. req.hostname strips the port, and honours
     * X-Forwarded-Host because index.js sets `trust proxy` — which is what
     * makes this work behind Caddy.
     */
    if (!tenant) {
      const host = String(req.hostname || '').toLowerCase();
      tenant = await findTenantByHost(host);
      if (tenant) via = 'hostname';
    }

    /*
     * The fallback that makes single-hospital deployment work without a second
     * code path.
     *
     * On a hospital's own server there is exactly one tenant and the hostname
     * could be anything — their domain, an IP address, localhost during setup.
     * DEFAULT_TENANT says "when nothing else matched, it is this one". It is
     * also what makes localhost development work.
     */
    if (!tenant && process.env.DEFAULT_TENANT) {
      tenant = await findTenantBySlug(process.env.DEFAULT_TENANT);
      if (tenant) via = 'default';
    }

    if (!tenant) {
      /*
       * Deliberately plain, and deliberately 404.
       *
       * Naming the hostname, or saying "no such hospital", turns this endpoint
       * into a way to enumerate customers — try hostnames, see which ones
       * answer differently. One response for every unrecognised host.
       */
      return res.status(404).json({ error: 'Not found' });
    }

    if (tenant.status === 'suspended') {
      return res.status(403).json({
        error: 'This installation is not currently active. Please contact your administrator.'
      });
    }

    if (tenant.status === 'onboarding') {
      return res.status(503).json({
        error: 'This installation is still being set up. Please try again shortly.'
      });
    }

    /*
     * Note what is NOT on req.tenant: databaseUrl.
     *
     * It is a credential. Any route that echoed req.tenant — a debug endpoint,
     * an error handler being helpful, a log line — would leak the database
     * password. Only the fields a route could legitimately want are copied.
     */
    req.tenant = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      via
    };

    req.prisma = getPrisma(tenant);

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * How many migrations have actually been applied to this hospital's database.
 *
 * This is what lets a fleet script answer "is hospital 37 on the current
 * version" without SSH. In SaaS mode every database must match one code
 * version, and a migration that failed on one of them leaves a split brain that
 * is otherwise invisible until something breaks.
 */
/**
 * How many migrations this CODE ships, counted from the folders on disk.
 *
 * Paired with appliedMigrationCount, this is the whole of drift detection: if
 * the code carries five migrations and a hospital's database has four, that
 * hospital is one schema change behind the code running against it, and
 * something is going to fail in a way that names the wrong thing.
 *
 * Read once and cached — the folder cannot change while the process runs.
 */
let expectedCache = null;

export function expectedMigrationCount() {
  if (expectedCache !== null) return expectedCache;

  try {
    const dir = new URL('../prisma/migrations/', import.meta.url);
    expectedCache = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .length;
  } catch {
    // No migrations folder is a packaging problem, not a schema problem, and
    // guessing a number here would invent drift that does not exist.
    expectedCache = null;
  }

  return expectedCache;
}

export async function appliedMigrationCount(prisma) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT count(*)::int AS n
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
    `;
    return rows?.[0]?.n ?? 0;
  } catch {
    // The table does not exist until the first migration runs. That is not an
    // error — it is the honest answer, "none applied yet".
    return 0;
  }
}
