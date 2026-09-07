#!/usr/bin/env node
/**
 * Empty a hospital's database and start it again from nothing.
 *
 *   npm run reset -- --slug clinic --confirm clinic
 *
 * For clearing junk from a pilot, not for anything else.
 *
 * THIS IS THE MOST DANGEROUS COMMAND IN THE REPOSITORY, so it is also the most
 * obstructed:
 *
 *   - the slug must be typed twice, the second time as --confirm
 *   - it REFUSES outright on a hospital whose status is "active"
 *   - it takes a backup first, and stops if the backup fails
 *   - it never touches another hospital, because each has its own database
 *
 * That last point is the tenancy design paying off. On a shared-table system
 * this would be a DELETE across forty tables filtered by tenant, and getting
 * one filter wrong would empty somebody else's hospital. Here it is DROP
 * DATABASE, and the blast radius is exactly one.
 */
import { spawn } from 'node:child_process';
import { control } from '../lib/control-plane.js';
import { API_DIR, runPrisma, requireControlUrl, arg, die } from './_shared.mjs';

requireControlUrl();

const slug = arg('slug');
const confirm = arg('confirm');

if (!slug) die('--slug is required.');

const tenant = await control.tenant.findUnique({ where: { slug } });
if (!tenant) die(`No hospital with slug "${slug}".`);

// ---------------------------------------------------------------------------
// The status gate.
//
// A hospital marked "active" has real patients in it. Wiping one is not
// something a flag should be able to do — it needs a person to change the
// status first, which is a deliberate second act with its own audit trail.
// ---------------------------------------------------------------------------
if (tenant.status === 'active') {
  die(
    `${tenant.name} is ACTIVE. Refusing.\n\n` +
    'An active hospital has real patients. If this really is a pilot that\n' +
    'should be wiped, set its status to "piloting" in the control plane first —\n' +
    'and if it is not, you have just been saved from something irreversible.'
  );
}

if (confirm !== slug) {
  die(
    `About to DESTROY every record in ${tenant.name} (${slug}).\n\n` +
    'Patients, visits, documents, users and the audit log. All of it.\n\n' +
    `To proceed, type the slug again:  --confirm ${slug}`
  );
}

// ---------------------------------------------------------------------------
// Back up first, always.
//
// Even a pilot database contains somebody's afternoon. And "I'll just reset it,
// there was nothing important" is a sentence people say immediately before
// discovering there was.
// ---------------------------------------------------------------------------
console.log(`\n▸ backing up ${slug} before wiping it`);

const backup = await new Promise(resolve => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'backup', '--', '--only', slug],
    { cwd: API_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('close', resolve);
  child.on('error', () => resolve(1));
});

if (backup !== 0) {
  die('The backup failed, so the reset has not run. Fix the backup first.');
}

// ---------------------------------------------------------------------------
// Read the hospital's MRN settings BEFORE dropping, because the drop takes
// them with it.
//
// An earlier version rebuilt the prefix from the slug afterwards. That quietly
// changed the hospital's numbering on every reset — a hospital that chose
// "SNH" came back as "STN", and nobody notices a prefix change until a printed
// folder label stops matching the screen. Whatever they chose at onboarding is
// what they get back.
// ---------------------------------------------------------------------------
const { getPrisma } = await import('../lib/tenancy.js');

let mrnSetting = null;
try {
  const before = getPrisma(tenant);
  const row = await before.setting.findUnique({ where: { key: 'mrn' } });
  mrnSetting = row?.value ?? null;
  await before.$disconnect();
} catch {
  // An unreachable or half-built database is exactly the kind of thing this
  // command gets used on, so this is not fatal — but it does mean we cannot
  // put the prefix back without being told what it was.
}

if (!mrnSetting?.prefix) {
  const given = arg('prefix');
  if (!given) {
    die(
      `Could not read ${slug}'s MRN prefix from its database, so this reset\n` +
      'would have to guess at it — and a guessed prefix silently renames every\n' +
      'patient folder the hospital prints from here on.\n\n' +
      'Pass the prefix the hospital actually uses:\n' +
      `  npm run reset -- --slug ${slug} --confirm ${slug} --prefix SNH`
    );
  }
  mrnSetting = { prefix: given.toUpperCase().slice(0, 6), resetYearly: true, pad: 5 };
}

// ---------------------------------------------------------------------------
// Drop and rebuild.
//
// DROP DATABASE, not TRUNCATE. Truncating would leave the schema at whatever
// version it happened to be, and leave sequences and the audit trigger in an
// unknown state. Dropping and re-migrating gives a database identical to one a
// hospital onboarded today would get — which is the actual goal.
// ---------------------------------------------------------------------------
const dbName = new URL(tenant.databaseUrl).pathname.replace(/^\//, '');

console.log(`\n▸ dropping ${dbName}`);
// Existing connections block a drop, and the API is probably holding one.
await control.$executeRawUnsafe(`
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '${dbName}' AND pid <> pg_backend_pid()
`);
await control.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);

console.log(`▸ creating ${dbName}`);
await control.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);

console.log(`▸ applying migrations\n`);
const code = await runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], tenant.databaseUrl);
if (code !== 0) {
  die(`Migrations failed (exit ${code}). ${dbName} exists but is empty of tables.`);
}

// The MRN settings live in the hospital's own Setting table, so they went with
// the drop. Put back exactly what was read above.
const db = getPrisma(tenant);
const prefix = mrnSetting.prefix;
await db.setting.upsert({
  where: { key: 'mrn' },
  create: { key: 'mrn', value: mrnSetting },
  update: { value: mrnSetting }
});
await db.$disconnect();

// A fresh setup token, because the users table went too and somebody has to be
// able to get back in.
const { randomBytes } = await import('node:crypto');
const setupToken = randomBytes(24).toString('hex');
await control.tenant.update({ where: { id: tenant.id }, data: { setupToken } });

console.log(`\n✓ ${tenant.name} is empty and freshly migrated.\n`);
console.log('  ┌─ NEW SETUP TOKEN ' + '─'.repeat(48));
console.log(`  │  ${setupToken}`);
console.log('  └' + '─'.repeat(66));
console.log('\n  Every account was destroyed with the database, so the first');
console.log('  person back in creates a new one with this token.\n');
console.log(`  MRN prefix is still ${prefix}, but numbering restarts at 00001 —`);
console.log('  so any folder label printed before this reset now names a');
console.log('  different patient. Destroy them.\n');

await control.$disconnect();
