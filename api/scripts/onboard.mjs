#!/usr/bin/env node
/**
 * Onboard a hospital.
 *
 *   npm run onboard -- --slug stnicholas \
 *                      --name "St Nicholas Hospital" \
 *                      --host stnicholas.localhost
 *
 *   --slug          machine name. lowercase letters, digits, single hyphens.
 *   --name          display name.
 *   --host          hostname, or several separated by commas.
 *   --database-url  optional. Use when this hospital's database is not on the
 *                   same server as the control plane — a hospital running on
 *                   its own infrastructure, for instance.
 *
 * Four steps: create the database, apply every migration to it, register it in
 * the control plane, then mark it active. It refuses rather than half-repeating
 * if anything already exists.
 *
 * This is the command that replaces creating a database by hand. Milestone 01's
 * hms_dev was the last one made manually.
 */
import { control } from '../lib/control-plane.js';
import {
  runPrisma, requireControlUrl, withDatabase, dbNameFor,
  arg, SLUG_RE, die
} from './_shared.mjs';

const controlUrl = requireControlUrl();

const slug = arg('slug');
const name = arg('name');
const hostArg = arg('host');

if (!slug || !SLUG_RE.test(slug)) {
  die('--slug is required: lowercase letters, digits and single hyphens.\n' +
      'Example: --slug stnicholas');
}
if (!name) die('--name is required. Example: --name "St Nicholas Hospital"');
if (!hostArg) die('--host is required. Example: --host stnicholas.localhost');

const hostnames = hostArg
  .split(',')
  .map(h => h.trim().toLowerCase())
  .filter(Boolean);

if (hostnames.length === 0) die('--host produced no usable hostnames.');

const dbName = dbNameFor(slug);
const databaseUrl = arg('database-url') ?? withDatabase(controlUrl, dbName);

console.log(`\nOnboarding "${name}"`);
console.log(`  slug       ${slug}`);
console.log(`  hostnames  ${hostnames.join(', ')}`);
console.log(`  database   ${dbName}\n`);

// ---------------------------------------------------------------------------
// 1. Refuse early if anything is taken.
//
// Checked before the database is created so a collision leaves nothing behind
// to clean up. The hostname check is the important one: a hostname pointing at
// two hospitals is the worst failure this system has, and the schema makes it
// impossible — this just turns the constraint violation into a readable error.
// ---------------------------------------------------------------------------
const existingTenant = await control.tenant.findUnique({ where: { slug } });
if (existingTenant) {
  die(`A hospital with slug "${slug}" already exists (${existingTenant.name}).`);
}

const takenHosts = await control.tenantHostname.findMany({
  where: { hostname: { in: hostnames } },
  include: { tenant: { select: { name: true, slug: true } } }
});

if (takenHosts.length > 0) {
  die(
    'These hostnames are already in use:\n' +
    takenHosts.map(h => `  ${h.hostname} -> ${h.tenant.name} (${h.tenant.slug})`).join('\n')
  );
}

// ---------------------------------------------------------------------------
// 2. Create the database.
//
// Issued over the control-plane connection, which is a different database from
// the one being created — CREATE DATABASE cannot run from inside the database
// it creates, and cannot run inside a transaction either.
//
// The name is interpolated rather than parameterised because Postgres does not
// accept a bind parameter for an identifier. It is safe here only because
// dbNameFor derives it from a slug already checked against SLUG_RE; do not
// loosen that regular expression without revisiting this line.
// ---------------------------------------------------------------------------
const exists = await control.$queryRaw`
  SELECT 1 FROM pg_database WHERE datname = ${dbName}
`;

if (exists.length > 0) {
  console.log(`▸ database ${dbName} already exists — leaving it alone`);
} else {
  console.log(`▸ creating database ${dbName}`);
  await control.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
}

// ---------------------------------------------------------------------------
// 3. Apply every migration to it.
//
// `migrate deploy`, never `migrate dev`: deploy only applies migrations that
// already exist and can never reset anything.
//
// At milestone 02 there are no tenant migrations yet, so prisma reports that it
// found none and exits 0. That is the correct outcome, not a failure.
// ---------------------------------------------------------------------------
console.log(`▸ applying migrations\n`);
const code = await runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], databaseUrl);

if (code !== 0) {
  die(
    `Migrations failed for ${dbName} (exit ${code}).\n` +
    'The database was created but is NOT registered, so nothing routes to it.\n' +
    `Fix the cause, drop it with: DROP DATABASE "${dbName}";  then run this again.`
  );
}

// ---------------------------------------------------------------------------
// 4. Register it, then open it.
//
// Created as "onboarding" and flipped to "active" only once everything above
// has succeeded. In between, resolveTenant answers 503 with a clear message
// rather than letting anyone into a half-built installation.
// ---------------------------------------------------------------------------
const tenant = await control.tenant.create({
  data: {
    slug,
    name,
    databaseUrl,
    status: 'onboarding',
    hostnames: { create: hostnames.map(hostname => ({ hostname })) }
  }
});

await control.tenant.update({
  where: { id: tenant.id },
  data: { status: 'active' }
});

console.log(`\n✓ ${name} is active.\n`);
console.log('  Reach it by hostname, or in development by either of:');
console.log(`    DEFAULT_TENANT=${slug}     in api/.env`);
console.log(`    X-Tenant: ${slug}          as a request header\n`);
console.log('  Resolution is cached for up to a minute, so a running API may');
console.log('  take that long to notice.\n');

await control.$disconnect();
