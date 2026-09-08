import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Shared helpers for the fleet scripts.
 *
 * WHY THESE ARE NODE SCRIPTS AND NOT npm ONE-LINERS
 *
 * Every one of them needs to run prisma against a DIFFERENT database each time:
 * the control plane for control migrations, each hospital in turn for tenant
 * migrations. On Linux that is `DATABASE_URL=... npx prisma migrate deploy`.
 * On Windows it is not — cmd.exe does not understand inline environment
 * assignment, and the command silently runs against whatever DATABASE_URL
 * happens to be in .env. Which, on a production machine, would mean applying a
 * hospital's migrations to the wrong hospital.
 *
 * Setting the environment per spawn removes the platform from the question.
 */

export const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Run the prisma CLI with an explicit DATABASE_URL. Resolves to an exit code. */
export function runPrisma(args, databaseUrl) {
  return new Promise(resolve => {
    const isWindows = process.platform === 'win32';

    const child = spawn(
      isWindows ? 'npx.cmd' : 'npx',
      ['prisma', ...args],
      {
        cwd: API_DIR,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'inherit',
        shell: isWindows
      }
    );

    child.on('error', err => {
      console.error('Could not start the prisma CLI:', err.message);
      resolve(1);
    });
    child.on('close', code => resolve(code ?? 1));
  });
}

/**
 * Swap the database name in a connection string, keeping credentials, host,
 * port and query parameters intact.
 *
 * This is how a hospital's connection string is derived from the control
 * plane's by default: same server, same credentials, different database. Pass
 * --database-url to onboard.mjs when a hospital's database lives somewhere else
 * entirely, which is the case the design has to allow for.
 */
export function withDatabase(url, dbName) {
  const parsed = new URL(url);
  parsed.pathname = '/' + dbName;
  return parsed.toString();
}

/**
 * clinisynx_stnicholas_db — the name of one hospital's database.
 *
 * Hyphens become underscores because a Postgres identifier containing a hyphen
 * has to be quoted everywhere it appears, forever, and one place that forgets
 * is a bug that only shows up for hospitals whose slug happens to have one.
 *
 * The shared prefix is the point: `psql -l | grep clinisynx` shows the whole
 * system and nothing else on a machine that may be running other things.
 *
 * CHANGING THIS AFTER A HOSPITAL IS ONBOARDED DOES NOTHING to that hospital.
 * Its full connection URL is stored in the control plane at onboarding, so it
 * keeps using the name it was created with; only newly onboarded hospitals get
 * the new shape. That is a feature — it means renaming here can never orphan a
 * live database — but it does mean a rename leaves the fleet in two shapes
 * until every hospital has been re-onboarded.
 */
export function dbNameFor(slug) {
  const name = `clinisynx_${slug.replace(/-/g, '_')}_db`;

  // Postgres truncates identifiers at 63 bytes SILENTLY, with only a notice.
  // Two hospitals with long, similar slugs would truncate to the same name and
  // the second onboarding would attach itself to the first one's database.
  // Refusing here is the difference between a clear error and a catastrophe.
  if (name.length > 63) {
    throw new Error(
      `The database name for slug "${slug}" would be ${name.length} characters:\n` +
      `  ${name}\n` +
      'Postgres truncates identifiers at 63 and does not fail when it does, so\n' +
      'two long similar slugs can silently end up sharing one database.\n' +
      `Use a shorter slug: at most ${63 - 'clinisynx__db'.length} characters.`
    );
  }

  return name;
}

/** Read --name value / --name=value from argv. */
export function arg(name, fallback = undefined) {
  const argv = process.argv.slice(2);

  const exact = argv.indexOf(`--${name}`);
  if (exact !== -1 && argv[exact + 1] && !argv[exact + 1].startsWith('--')) {
    return argv[exact + 1];
  }

  const inline = argv.find(a => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);

  return fallback;
}

export function has(flag) {
  return process.argv.slice(2).includes(`--${flag}`);
}

export function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

export function requireControlUrl() {
  const url = process.env.CONTROL_PLANE_URL;
  if (!url) {
    die('CONTROL_PLANE_URL is not set in api/.env. See api/.env.example.');
  }
  return url;
}
