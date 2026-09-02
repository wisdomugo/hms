#!/usr/bin/env node
/**
 * Apply migrations to the CONTROL PLANE.
 *
 *   npm run control:migrate            apply existing migrations (safe anywhere)
 *   npm run control:migrate -- --dev   create a new migration after editing
 *                                      prisma/control/schema.prisma
 *
 * --dev is a DEVELOPMENT command. It can offer to reset the database when it
 * detects drift, and on a server that would drop the routing table for every
 * hospital. It refuses to run when NODE_ENV is production.
 */
import { runPrisma, requireControlUrl, arg, has, die } from './_shared.mjs';

const CONTROL_SCHEMA = 'prisma/control/schema.prisma';
const url = requireControlUrl();

const dev = has('dev');

if (dev && process.env.NODE_ENV === 'production') {
  die(
    'Refusing to run `migrate dev` with NODE_ENV=production.\n' +
    'It can reset the database when it detects drift, and this database is the\n' +
    'routing table for every hospital. Use `npm run control:migrate` instead.'
  );
}

const args = dev
  ? ['migrate', 'dev', '--schema', CONTROL_SCHEMA, '--name', arg('name', 'control_change')]
  : ['migrate', 'deploy', '--schema', CONTROL_SCHEMA];

console.log(`\n▸ prisma ${args.join(' ')}`);
console.log('  against the control plane\n');

const code = await runPrisma(args, url);

if (code === 0) {
  console.log('\n▸ generating the control-plane client\n');
  process.exit(await runPrisma(['generate', '--schema', CONTROL_SCHEMA], url));
}

process.exit(code);
