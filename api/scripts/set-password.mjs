#!/usr/bin/env node
/**
 * Issue a temporary password for an account, from the server.
 *
 *   npm run set-password -- --slug stnicholas --email cmd@hospital.ng
 *   npm run set-password -- --slug stnicholas --list
 *
 * THE BREAK-GLASS PATH, and the reason it exists:
 *
 * A member of staff who forgets their password asks the hospital's owner, who
 * resets it from the Staff screen. That covers everyone except one person —
 * the owner. When the owner is locked out there is nobody inside the hospital
 * who can help, and before this existed the only route back in was
 * reset-tenant.mjs, which destroys every patient record in the process.
 *
 * "I can delete your hospital's data, or nothing" is not an answer anybody
 * should have to give. This is the other answer.
 *
 * It requires shell access to the server, which is exactly the right bar: the
 * people who can run this are the people who could read the database anyway.
 *
 * The password is printed ONCE and is not stored. The account must choose a new
 * one at its next sign-in, because this password gets spoken down a telephone.
 */
import { control } from '../lib/control-plane.js';
import { getPrisma } from '../lib/tenancy.js';
import { requireControlUrl, arg, has, die } from './_shared.mjs';
import * as auth from '../modules/auth/service.js';

requireControlUrl();

const slug = arg('slug');
const email = arg('email');

if (!slug) {
  die('--slug is required. Which hospital?\n\n' +
      '  npm run set-password -- --slug stnicholas --list');
}

const tenant = await control.tenant.findUnique({ where: { slug } });
if (!tenant) die(`No hospital with slug "${slug}".`);

const db = getPrisma(tenant);

// ---------------------------------------------------------------------------
// --list, because you will not remember the exact email at the moment you
// need it, and guessing wrong at a prompt like this wastes a phone call.
// ---------------------------------------------------------------------------
if (has('list') || !email) {
  const users = await auth.listUsers(db);

  console.log(`\n  ${tenant.name} (${slug}) — ${users.length} account${users.length === 1 ? '' : 's'}\n`);

  if (users.length === 0) {
    console.log('  None. This hospital has never been set up, or was reset.\n');
  } else {
    const w = Math.max(...users.map(u => u.email.length), 5);
    console.log(`  ${'EMAIL'.padEnd(w)}  ${'ROLE'.padEnd(6)}  ${'ACTIVE'.padEnd(6)}  NAME`);
    console.log(`  ${'─'.repeat(w)}  ${'─'.repeat(6)}  ${'─'.repeat(6)}  ${'─'.repeat(20)}`);
    for (const u of users) {
      const owed = u.mustChangePassword ? '  (owes a password change)' : '';
      console.log(
        `  ${u.email.padEnd(w)}  ${u.role.padEnd(6)}  ` +
        `${(u.isActive ? 'yes' : 'NO').padEnd(6)}  ${u.name ?? '—'}${owed}`
      );
    }
    console.log('');
  }

  if (!email) {
    console.log('  To reset one:');
    console.log(`    npm run set-password -- --slug ${slug} --email someone@example.com\n`);
  }

  if (!email) {
    await db.$disconnect();
    await control.$disconnect();
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Reset.
// ---------------------------------------------------------------------------
const target = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });

if (!target) {
  die(`No account with email "${email}" at ${tenant.name}.\n\n` +
      `See what is there:  npm run set-password -- --slug ${slug} --list`);
}

const result = await auth.issueTemporaryPassword(db, { userId: target.id });
if (result.error) die(`Could not reset: ${result.error}`);

/*
 * Recorded in the hospital's own audit log, with no actor.
 *
 * A null actorId is honest: this did not happen through the application and
 * nobody signed in to do it. What matters is that the hospital can see it
 * happened at all — an administrator reaching into the database to take over an
 * account is precisely the event an append-only audit log exists to make
 * undeniable, including when the administrator is you.
 */
const { record, ACTIONS } = await import('../lib/audit.js');
await record(db, {
  action: ACTIONS.PASSWORD_RESET_ISSUED,
  entity: 'User',
  entityId: target.id,
  actorEmail: 'set-password.mjs (server console)',
  meta: {
    targetEmail: target.email,
    sessionsEnded: result.sessionsEnded,
    via: 'server-console'
  }
});

console.log(`\n  Temporary password for ${target.email} at ${tenant.name}:\n`);
console.log('  ┌' + '─'.repeat(46));
console.log(`  │   ${result.password}`);
console.log('  └' + '─'.repeat(46));
console.log('\n  Shown once. It is not stored and cannot be printed again.');
console.log(`  ${result.sessionsEnded} existing session${result.sessionsEnded === 1 ? '' : 's'} ended, so anyone`);
console.log('  holding that account is now signed out.');
console.log('\n  They must choose a new password the moment they sign in —');
console.log('  the API refuses everything else until they do.\n');
console.log('  Read it to them yourself. Do not send it by SMS or email,');
console.log('  which keep a copy of it long after the call is over.\n');

await db.$disconnect();
await control.$disconnect();
