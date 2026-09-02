#!/usr/bin/env node
/**
 * Apply pending migrations to EVERY hospital database.
 *
 *   npm run migrate:all
 *   npm run migrate:all -- --only stnicholas,demo
 *   npm run migrate:all -- --dry-run
 *
 * This is the command that runs as part of every deploy. It is also the one
 * that makes migration drift visible: it reports per hospital, and exits
 * non-zero if any of them failed, so a deploy script can stop.
 *
 * WHY DRIFT MATTERS MORE HERE THAN IN A SINGLE-DATABASE SYSTEM
 *
 * All hospitals run one code version. A migration that succeeds on forty
 * databases and fails on the forty-first leaves that hospital running new code
 * against an old schema — which does not announce itself, and surfaces later as
 * an unrelated-looking error in whatever feature happened to touch the missing
 * column first.
 */
import { control } from '../lib/control-plane.js';
import { runPrisma, requireControlUrl, arg, has } from './_shared.mjs';

requireControlUrl();

const only = arg('only');
const dryRun = has('dry-run');

const where = only
  ? { slug: { in: only.split(',').map(s => s.trim()).filter(Boolean) } }
  : {};

const tenants = await control.tenant.findMany({
  where,
  orderBy: { slug: 'asc' },
  select: { slug: true, name: true, databaseUrl: true, status: true }
});

if (tenants.length === 0) {
  console.log('\nNo hospitals registered. Nothing to migrate.\n');
  await control.$disconnect();
  process.exit(0);
}

console.log(`\n${tenants.length} hospital${tenants.length === 1 ? '' : 's'} to migrate\n`);

if (dryRun) {
  for (const t of tenants) console.log(`  ${t.slug.padEnd(20)} ${t.status.padEnd(12)} ${t.name}`);
  console.log('\n--dry-run: nothing was applied.\n');
  await control.$disconnect();
  process.exit(0);
}

const results = [];

for (const tenant of tenants) {
  console.log(`\n──── ${tenant.slug} — ${tenant.name} ${'─'.repeat(Math.max(0, 40 - tenant.slug.length))}\n`);

  // Sequential, not Promise.all. Running forty migrations at once against one
  // Postgres server is a good way to exhaust connections, and interleaved
  // output would make a single failure impossible to find.
  const code = await runPrisma(
    ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    tenant.databaseUrl
  );

  results.push({ slug: tenant.slug, name: tenant.name, ok: code === 0, code });
}

// ---------------------------------------------------------------------------
// The summary is the point of the script. Per-hospital output scrolls away;
// this is what a person actually reads.
// ---------------------------------------------------------------------------
const failed = results.filter(r => !r.ok);
const width = Math.max(...results.map(r => r.slug.length), 8);

console.log('\n\n════ Summary ════\n');
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'}  ${r.slug.padEnd(width)}  ${r.ok ? 'up to date' : `FAILED (exit ${r.code})`}`);
}

console.log(`\n  ${results.length - failed.length}/${results.length} succeeded\n`);

if (failed.length > 0) {
  console.log('  Hospitals still on the old schema:');
  for (const r of failed) console.log(`    ${r.slug} — ${r.name}`);
  console.log('\n  These are running new code against an old schema. Fix them before');
  console.log('  the deploy is considered done.\n');
}

await control.$disconnect();
process.exit(failed.length > 0 ? 1 : 0);
