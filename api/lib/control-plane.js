import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/control/client.ts';

/*
 * THE ONE LEGITIMATE SINGLETON IN THIS SYSTEM.
 *
 * lib/README.md says no module imports a Prisma client. This is the exception,
 * and it is an exception because it is the opposite kind of thing: there is
 * exactly one control plane per running instance, it holds no patient data, and
 * it is what the tenant clients are built FROM.
 *
 * The rule still holds everywhere it matters — no module touching hospital data
 * imports a client. Those all read req.prisma.
 */

const CONTROL_URL = process.env.CONTROL_PLANE_URL;

if (!CONTROL_URL) {
  throw new Error(
    'CONTROL_PLANE_URL is not set. Without it the API cannot work out which ' +
    'hospital a request belongs to, so it refuses to start rather than serving ' +
    'requests it cannot route. See api/.env.example.'
  );
}

export const control = new PrismaClient({
  adapter: new PrismaPg({ connectionString: CONTROL_URL, max: 5 })
});

/*
 * Lookups are cached, because resolution runs on EVERY request.
 *
 * Misses are cached too, and that is not an oversight. Without it, anything
 * pointing an unknown hostname at this server — a scanner, a stale DNS record,
 * a typo in a bookmark — puts a database query in front of every one of its
 * requests. A shorter TTL for misses keeps a newly onboarded hospital from
 * waiting long.
 *
 * TTL rather than explicit invalidation because onboard.mjs runs in a different
 * process and cannot reach into this one. A minute is a reasonable wait for a
 * hospital that was created seconds ago; anything finer would need a channel
 * between the two, which is not worth building for this.
 */
const TTL_HIT_MS = Number(process.env.TENANT_CACHE_MS || 60_000);
const TTL_MISS_MS = 30_000;

const cache = new Map();   // key -> { value, expiresAt }

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;                 // not cached
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;                           // may legitimately be null
}

function writeCache(key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + (value ? TTL_HIT_MS : TTL_MISS_MS)
  });
}

/** Drop everything. Useful in tests, and after onboarding within one process. */
export function forgetTenants() {
  cache.clear();
}

export async function findTenantByHost(hostname) {
  if (!hostname) return null;
  const key = `host:${hostname}`;

  const hit = readCache(key);
  if (hit !== undefined) return hit;

  const row = await control.tenantHostname.findUnique({
    where: { hostname },
    include: { tenant: true }
  });

  const tenant = row?.tenant ?? null;
  writeCache(key, tenant);
  return tenant;
}

export async function findTenantBySlug(slug) {
  if (!slug) return null;
  const key = `slug:${slug}`;

  const hit = readCache(key);
  if (hit !== undefined) return hit;

  const tenant = await control.tenant.findUnique({ where: { slug } });
  writeCache(key, tenant);
  return tenant;
}

/**
 * For /health. Answers "is the control plane reachable" without throwing,
 * because a health endpoint that 500s tells a fleet script much less than one
 * that reports the specific thing that is wrong.
 */
export async function controlPlaneStatus() {
  try {
    const tenants = await control.tenant.count();
    return { reachable: true, tenants };
  } catch (err) {
    return { reachable: false, tenants: null, error: err.code ?? 'unreachable' };
  }
}
