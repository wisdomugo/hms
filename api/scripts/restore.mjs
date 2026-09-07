#!/usr/bin/env node
/**
 * Restore a hospital from a backup.
 *
 *   npm run restore -- --file backups/2026-09-06T09-00-00/clinic.sql.gz \
 *                      --into hms_clinic_restored
 *
 *   --file    the .sql.gz to restore
 *   --into    the database to restore INTO. Created if missing.
 *   --confirm required when --into is a database a hospital is currently using
 *
 * THIS SCRIPT DOES NOT POINT A HOSPITAL AT THE RESTORED DATA.
 *
 * It restores into a database and stops. Repointing is a separate, deliberate
 * act: update the tenant's databaseUrl in the control plane once you have
 * looked at what you restored and confirmed it is the right day.
 *
 * That separation exists because the worst moment to be automating things is
 * the moment you are restoring from backup — someone is already having a bad
 * day, and a script that helpfully switches production over to a dump from the
 * wrong week makes it considerably worse.
 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

import { control } from '../lib/control-plane.js';
import { requireControlUrl, withDatabase, arg, die } from './_shared.mjs';

const controlUrl = requireControlUrl();

const file = arg('file');
const into = arg('into');
const confirm = arg('confirm');

if (!file) die('--file is required. Point it at a .sql.gz from a backup run.');
if (!into) die('--into is required. Name the database to restore into.');
if (!/^[a-z0-9_]+$/i.test(into)) die('--into must be a plain database name: letters, digits, underscores.');

await access(path.resolve(file)).catch(() => die(`No such file: ${file}`));

// ---------------------------------------------------------------------------
// Refuse to overwrite a database a hospital is actually using, unless told
// twice. Restoring over live data is occasionally the right thing to do and
// always worth pausing over.
// ---------------------------------------------------------------------------
const inUse = await control.tenant.findFirst({
  where: { databaseUrl: { contains: `/${into}` } },
  select: { slug: true, name: true, status: true }
});

if (inUse && confirm !== into) {
  die(
    `${into} is the live database for ${inUse.name} (${inUse.slug}, ${inUse.status}).\n` +
    `Restoring into it will REPLACE what is there now.\n\n` +
    `If that is what you mean, add:  --confirm ${into}\n` +
    `If it is not, restore into a new name and compare first:\n` +
    `  --into ${into}_restored`
  );
}

const targetUrl = withDatabase(controlUrl, into);

const exists = await control.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${into}`;

if (exists.length === 0) {
  console.log(`\n▸ creating ${into}`);
  await control.$executeRawUnsafe(`CREATE DATABASE "${into}"`);
} else {
  console.log(`\n▸ ${into} already exists — the dump will be layered onto it`);
  console.log('  A plain pg_dump recreates its tables, so existing tables of the');
  console.log('  same name will collide. Restore into a fresh name if unsure.');
}

console.log(`▸ restoring ${path.basename(file)}\n`);

const code = await new Promise((resolve, reject) => {
  const gunzip = spawn('gunzip', ['-c', path.resolve(file)]);
  const psql = spawn('psql', ['--quiet', '--set', 'ON_ERROR_STOP=1', targetUrl],
                     { stdio: ['pipe', 'inherit', 'inherit'] });

  gunzip.on('error', reject);
  psql.on('error', reject);
  gunzip.stdout.pipe(psql.stdin);
  psql.on('close', resolve);
});

if (code !== 0) {
  await control.$disconnect();
  die(`Restore failed (psql exited ${code}). ${into} may be partially written.`);
}

console.log(`\n✓ restored into ${into}\n`);
console.log('  Next, and deliberately not automatic:');
console.log(`    1. Look at what you restored — psql ${into}, count patients, check the newest MRN.`);
console.log('    2. When you are satisfied it is the right day, point the hospital at it');
console.log('       by updating its databaseUrl in the control plane.');
console.log('    3. Restart the API so cached tenant clients are rebuilt.\n');

await control.$disconnect();
