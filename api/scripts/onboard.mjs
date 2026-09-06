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
 *   --prefix        optional. The MRN prefix, e.g. STN in STN/2026/00042-7.
 *                   Defaults to the first three letters of the slug, upper-cased.
 *   --database-url  optional. Use when this hospital's database is not on the
 *                   same server as the control plane — a hospital running on
 *                   its own infrastructure, for instance.
 *
 * Five steps: create the database, apply every migration to it, register it,
 * mark it active, and print its single-use setup token. It refuses rather than
 * half-repeating if anything already exists.
 */
import { randomBytes } from 'node:crypto';
import { control } from '../lib/control-plane.js';
import { getPrisma } from '../lib/tenancy.js';
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

// The MRN prefix. Derived rather than demanded, because a hospital onboarded
// in a hurry should still get a sensible number — but overridable, because
// "STN" reads better than "STN" derived from "stnicholas" always would.
//
// It is stored in the hospital's own Setting table, not here: it belongs to the
// hospital's data, and lib/numbers.js reads it from there on every issue.
const prefix = (arg('prefix') ?? slug.replace(/[^a-z0-9]/g, '').slice(0, 3))
  .toUpperCase()
  .slice(0, 6);

const dbName = dbNameFor(slug);
const databaseUrl = arg('database-url') ?? withDatabase(controlUrl, dbName);

console.log(`\nOnboarding "${name}"`);
console.log(`  slug       ${slug}`);
console.log(`  hostnames  ${hostnames.join(', ')}`);
console.log(`  MRN prefix ${prefix}      e.g. ${prefix}/${new Date().getFullYear()}/00001-x`);
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
// 3b. Write the hospital's own settings into its own database.
//
// The MRN prefix lives with the hospital's data rather than in the control
// plane, because it is a fact about how that hospital numbers its folders — the
// same kind of thing as its name on a receipt. lib/numbers.js reads it on every
// issue, and a missing row simply means the shipped default applies.
// ---------------------------------------------------------------------------
console.log(`▸ setting the MRN prefix to ${prefix}`);

const tenantDb = getPrisma({ databaseUrl });
await tenantDb.setting.upsert({
  where: { key: 'mrn' },
  create: { key: 'mrn', value: { prefix, resetYearly: true, pad: 5 } },
  update: { value: { prefix, resetYearly: true, pad: 5 } }
});
await tenantDb.$disconnect();

// ---------------------------------------------------------------------------
// 4. Register it, then open it.
//
// Created as "onboarding" and flipped to "active" only once everything above
// has succeeded. In between, resolveTenant answers 503 with a clear message
// rather than letting anyone into a half-built installation.
//
// THE SETUP TOKEN is generated here and printed once. It authorises creating
// this hospital's first account, and nothing else. It is single-use and scoped
// to this hospital — which is why it lives in the control plane rather than in
// .env, where one token would cover every hospital on the server.
// ---------------------------------------------------------------------------
const setupToken = randomBytes(24).toString('hex');

const tenant = await control.tenant.create({
  data: {
    slug,
    name,
    databaseUrl,
    setupToken,
    status: 'onboarding',
    hostnames: { create: hostnames.map(hostname => ({ hostname })) }
  }
});

await control.tenant.update({
  where: { id: tenant.id },
  data: { status: 'active' }
});

console.log(`\n✓ ${name} is active.\n`);
console.log('  ┌─ SETUP TOKEN ' + '─'.repeat(52));
console.log(`  │  ${setupToken}`);
console.log('  └' + '─'.repeat(66));
console.log('\n  Shown once, and only here. It authorises creating this');
console.log('  hospital\'s first account, then it is spent.');
console.log('  Lost it? Onboarding is the only thing that issues one — clear');
console.log(`  the row and start again, or set it by hand in the control plane.\n`);
console.log('  Reach this hospital by hostname, or in development by either of:');
console.log(`    DEFAULT_TENANT=${slug}     in api/.env`);
console.log(`    X-Tenant: ${slug}          as a request header\n`);
console.log('  Resolution is cached for up to a minute, so a running API may');
console.log('  take that long to notice.\n');

await control.$disconnect();
