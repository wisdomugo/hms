#!/usr/bin/env node
/**
 * Back up the control plane and every hospital database.
 *
 *   npm run backup
 *   npm run backup -- --only clinic
 *   npm run backup -- --verify        also restore the newest dump and count rows
 *
 * Writes to BACKUP_DIR (default ./backups), one dated folder per run, gzipped,
 * with a manifest. Prunes runs older than BACKUP_KEEP_DAYS.
 *
 * WHY THIS IS THE MOST IMPORTANT SCRIPT IN THE REPOSITORY
 *
 * Everything else here protects patient data from being seen by the wrong
 * person. This protects it from ceasing to exist. A confidentiality failure is
 * serious; losing a hospital's records entirely is worse, and until this script
 * ran for the first time, nothing in this system prevented it.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

import { control } from '../lib/control-plane.js';
import { API_DIR, requireControlUrl, withDatabase, arg, has, die } from './_shared.mjs';

const controlUrl = requireControlUrl();

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(API_DIR, 'backups');
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 14);

// Run after a successful backup, with the run's folder as $1. This is the hook
// for getting a copy OFF THIS MACHINE — rclone, aws s3 sync, scp, whatever the
// hospital's arrangement is. A backup that only exists on the server it backs
// up is not a backup; it is a copy that dies with the disk.
const UPLOAD_CMD = process.env.BACKUP_UPLOAD_CMD;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = path.join(BACKUP_DIR, stamp);

// ---------------------------------------------------------------------------

function run(command, args, { env, stdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: [ 'ignore', stdout ? 'pipe' : 'inherit', 'pipe' ]
    });

    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    if (stdout) child.stdout.pipe(stdout);

    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}\n${stderr.trim()}`))
    );
  });
}

/**
 * pg_dump straight into a gzip stream.
 *
 * Piped rather than dumped-then-compressed so a large hospital never needs
 * twice its database size in free disk — which is exactly the condition a
 * server is in when backups have been silently failing for a month.
 */
async function dump(databaseUrl, target) {
  const gzip = createGzip();
  const out = createWriteStream(target);
  const done = pipeline(gzip, out);

  await run('pg_dump', ['--no-owner', '--no-privileges', '--format=plain', databaseUrl], {
    stdout: gzip
  });

  gzip.end();
  await done;
}

async function checksum(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------

const only = arg('only');
const where = only ? { slug: { in: only.split(',').map(s => s.trim()) } } : {};

const tenants = await control.tenant.findMany({
  where,
  orderBy: { slug: 'asc' },
  select: { slug: true, name: true, databaseUrl: true }
});

await mkdir(runDir, { recursive: true });

console.log(`\nBacking up to ${runDir}\n`);

const results = [];

// The control plane first. Without it the tenant dumps are a pile of databases
// with nothing saying which hospital each belongs to or what hostname reaches
// it — recoverable, but only by someone who already knows.
const jobs = [
  { slug: '_control', name: 'Control plane', databaseUrl: controlUrl },
  ...tenants
];

for (const job of jobs) {
  const file = path.join(runDir, `${job.slug}.sql.gz`);
  process.stdout.write(`  ${job.slug.padEnd(20)}`);

  try {
    await dump(job.databaseUrl, file);
    const info = await stat(file);
    const sha = await checksum(file);

    results.push({ slug: job.slug, name: job.name, file: path.basename(file), bytes: info.size, sha256: sha, ok: true });
    console.log(`ok   ${(info.size / 1024).toFixed(0).padStart(7)} KB`);
  } catch (err) {
    results.push({ slug: job.slug, name: job.name, ok: false, error: err.message });
    console.log(`FAILED  ${err.message.split('\n')[0]}`);
  }
}

const failed = results.filter(r => !r.ok);

await writeFile(
  path.join(runDir, 'manifest.json'),
  JSON.stringify({ startedAt: stamp, keepDays: KEEP_DAYS, results }, null, 2)
);

// ---------------------------------------------------------------------------
// Verification.
//
// A backup nobody has restored is a hope, not a backup. This restores the
// newest hospital dump into a scratch database, counts its patients, and drops
// it again — which is the only thing that actually proves the file is usable.
//
// Off by default because it costs time and disk. Run it weekly, and after any
// change to this script.
// ---------------------------------------------------------------------------
if (has('verify')) {
  const candidate = results.find(r => r.ok && r.slug !== '_control');

  if (!candidate) {
    console.log('\n  Nothing to verify — no hospital dump succeeded.');
  } else {
    const scratch = `hms_verify_${Date.now()}`;
    console.log(`\n  Verifying ${candidate.slug} by restoring into ${scratch}`);

    try {
      await control.$executeRawUnsafe(`CREATE DATABASE "${scratch}"`);
      const scratchUrl = withDatabase(controlUrl, scratch);

      // gunzip | psql, without landing the plain SQL on disk.
      const gunzip = spawn('gunzip', ['-c', path.join(runDir, candidate.file)]);
      const psql = spawn('psql', ['--quiet', '--set', 'ON_ERROR_STOP=1', scratchUrl],
                         { stdio: ['pipe', 'ignore', 'pipe'] });
      let psqlErr = '';
      psql.stderr.on('data', d => { psqlErr += d.toString(); });
      gunzip.stdout.pipe(psql.stdin);

      await new Promise((resolve, reject) => {
        psql.on('close', code => code === 0 ? resolve() : reject(new Error(psqlErr.trim())));
        psql.on('error', reject);
      });

      /*
       * Read something back.
       *
       * Restoring without erroring is not proof — an empty dump restores
       * perfectly. Counting patients is what distinguishes "the file was valid
       * SQL" from "the hospital's records are in there".
       */
      const count = await new Promise((resolve, reject) => {
        const psqlCount = spawn('psql', [
          '--tuples-only', '--no-align', scratchUrl,
          '-c', 'SELECT count(*) FROM "Patient"'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let out = '', err = '';
        psqlCount.stdout.on('data', d => { out += d.toString(); });
        psqlCount.stderr.on('data', d => { err += d.toString(); });
        psqlCount.on('error', reject);
        psqlCount.on('close', code =>
          code === 0 ? resolve(Number(out.trim())) : reject(new Error(err.trim()))
        );
      });

      console.log(`  ✓ restored and readable — ${count} patient row(s) recovered`);
    } catch (err) {
      console.log(`  ✗ verification failed: ${err.message.split('\n')[0]}`);
      failed.push({ slug: candidate.slug, error: `verify: ${err.message}` });
    } finally {
      await control.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratch}"`).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Off-machine copy, then pruning.
//
// Pruning happens LAST and only when nothing failed. Deleting old backups
// because today's run half-worked is how a bad week becomes an unrecoverable
// one.
// ---------------------------------------------------------------------------
if (UPLOAD_CMD && failed.length === 0) {
  console.log(`\n  Copying off this machine: ${UPLOAD_CMD}`);
  await run('sh', ['-c', `${UPLOAD_CMD} "${runDir}"`])
    .then(() => console.log('  ✓ copied'))
    .catch(err => {
      console.log(`  ✗ off-machine copy FAILED: ${err.message.split('\n')[0]}`);
      failed.push({ slug: '_upload', error: err.message });
    });
} else if (!UPLOAD_CMD) {
  console.log('\n  BACKUP_UPLOAD_CMD is not set, so this backup exists only on');
  console.log('  this machine. A copy that dies with the disk it protects is');
  console.log('  not a backup. See docs/DEPLOYMENT.md.');
}

if (failed.length === 0) {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const runs = await readdir(BACKUP_DIR).catch(() => []);
  let pruned = 0;

  for (const name of runs) {
    if (name === path.basename(runDir)) continue;
    const dir = path.join(BACKUP_DIR, name);
    const info = await stat(dir).catch(() => null);
    if (info?.isDirectory() && info.mtimeMs < cutoff) {
      await rm(dir, { recursive: true, force: true });
      pruned++;
    }
  }
  if (pruned) console.log(`\n  Pruned ${pruned} run(s) older than ${KEEP_DAYS} days`);
}

console.log(`\n  ${results.length - failed.length}/${results.length} succeeded\n`);

await control.$disconnect();
process.exit(failed.length > 0 ? 1 : 0);
