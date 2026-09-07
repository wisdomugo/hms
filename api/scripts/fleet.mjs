#!/usr/bin/env node
/**
 * What is actually running out there.
 *
 *   npm run fleet
 *   npm run fleet -- --hosts https://clinic.example.com,https://stn.example.ng
 *
 * Polls each installation's /health and prints a table: reachable, version,
 * uptime, and whether its control plane is answering.
 *
 * WHY THIS EXISTS
 *
 * One instance per hospital buys isolation and costs visibility. Nobody watches
 * fifty servers, so without this the answer to "is hospital 37 up, and what
 * version is it on" is a phone call. This is the thing that makes the
 * deployment model survivable past about three hospitals.
 *
 * Reads hosts from the control plane's registered hostnames by default, so a
 * newly onboarded hospital appears here without anybody adding it to a list.
 */
import { control } from '../lib/control-plane.js';
import { requireControlUrl, arg } from './_shared.mjs';

requireControlUrl();

const scheme = process.env.FLEET_SCHEME || 'https';
const timeoutMs = Number(process.env.FLEET_TIMEOUT_MS || 5000);

const explicit = arg('hosts');

const targets = explicit
  ? explicit.split(',').map(h => ({ slug: '—', name: '', url: h.trim() }))
  : (await control.tenant.findMany({
      orderBy: { slug: 'asc' },
      select: { slug: true, name: true, status: true, hostnames: { select: { hostname: true }, take: 1 } }
    })).map(t => ({
      slug: t.slug,
      name: t.name,
      status: t.status,
      url: t.hostnames[0] ? `${scheme}://${t.hostnames[0].hostname}` : null
    }));

if (targets.length === 0) {
  console.log('\nNo hospitals registered.\n');
  await control.$disconnect();
  process.exit(0);
}

async function probe(target) {
  if (!target.url) return { ...target, state: 'no hostname' };

  // A timeout, because an unreachable host otherwise hangs the whole run behind
  // the operating system's default, which is measured in minutes.
  const abort = AbortSignal.timeout(timeoutMs);

  try {
    const res = await fetch(`${target.url}/health`, { signal: abort });
    if (!res.ok) return { ...target, state: `HTTP ${res.status}` };

    const health = await res.json();
    return {
      ...target,
      state: health.status,
      commit: health.commit ?? 'unset',
      uptime: health.uptime,
      controlPlane: health.controlPlane?.reachable ? 'ok' : 'UNREACHABLE',
      tenants: health.controlPlane?.tenants ?? '—'
    };
  } catch (err) {
    return { ...target, state: err.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
}

// In parallel: fifty sequential five-second timeouts is four minutes of
// somebody's morning.
const rows = await Promise.all(targets.map(probe));

const hours = s => (s == null ? '—' : s > 86400 ? `${Math.floor(s / 86400)}d` : `${Math.floor(s / 3600)}h`);
const w = Math.max(...rows.map(r => r.slug.length), 8);

console.log('');
console.log(`  ${'HOSPITAL'.padEnd(w)}  ${'STATE'.padEnd(12)}  ${'VERSION'.padEnd(10)}  ${'UP'.padEnd(5)}  CONTROL PLANE`);
console.log(`  ${'─'.repeat(w)}  ${'─'.repeat(12)}  ${'─'.repeat(10)}  ${'─'.repeat(5)}  ${'─'.repeat(13)}`);

for (const r of rows) {
  const bad = r.state !== 'ok';
  const mark = bad ? '\x1b[31m' : '\x1b[32m';
  console.log(
    `  ${mark}${r.slug.padEnd(w)}\x1b[0m  ${String(r.state).padEnd(12)}  ` +
    `${String(r.commit ?? '—').padEnd(10)}  ${hours(r.uptime).padEnd(5)}  ${r.controlPlane ?? '—'}`
  );
}

// Different versions across the fleet is the condition that produces bug
// reports nobody can reproduce, so it is called out rather than left to be
// noticed in the column.
const versions = [...new Set(rows.filter(r => r.commit && r.commit !== 'unset').map(r => r.commit))];
if (versions.length > 1) {
  console.log(`\n  \x1b[33m${versions.length} different versions are live: ${versions.join(', ')}\x1b[0m`);
  console.log('  A bug reported by one hospital may not exist in another.');
}

const down = rows.filter(r => r.state !== 'ok');
console.log(`\n  ${rows.length - down.length}/${rows.length} healthy\n`);

await control.$disconnect();
process.exit(down.length > 0 ? 1 : 0);
