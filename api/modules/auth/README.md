# modules/auth

Sign in, sign out, and the one-time creation of a hospital's first account.

This is the first module, so it also sets the shape the rest follow.

## The shape

| File | Holds |
|---|---|
| `routes.js` | HTTP only — parsing, status codes, cookies, which routes are public |
| `service.js` | The rules. Takes `prisma` as its first argument, so it is callable from another module without an HTTP hop |
| `README.md` | The decisions. Not a description of the code — the reasons that are not visible in it |

Milestone 05 adds `schema.js` (zod) to this list. Auth's validation is small
enough that inline checks are honest; a patient registration payload is not.

## Decisions

**One message for three failures.** An unknown email, a wrong password and a
deactivated account all return the same 401. Distinguishing them would make the
endpoint a way to discover which staff emails are real.

**Throttling lives in the hospital's database, not in memory.** In-memory
throttling resets on every restart — an attacker gets a fresh five attempts per
deploy — and counts nothing once there is more than one process. Being in the
tenant database also makes it per-hospital for free: hammering one hospital's
login cannot lock an account at another that shares an email address.

**The setup token is per hospital, single-use, and lives in the control
plane.** A `SETUP_TOKEN` in `.env` is one token for the whole server. On a
shared server that means whoever holds it can claim the first account at any
hospital not yet set up. `onboard.mjs` generates one per hospital and prints it
once; `/setup` verifies it, creates the account, then clears it.

Verified before creation and cleared after, in that order. Clearing first would
burn the token if account creation failed, leaving the hospital unable to set up
at all.

**`setupAvailable` is reported separately from `needsSetup`.** A hospital with
no accounts and no token left is stuck, and the app should say so rather than
showing a form that cannot succeed.

**Changing a password ends every other session but the current one.** A stolen
cookie must not survive the action taken to lock the attacker out. This is the
entire reason `requireAuth` records `req.sessionId`.

**Deactivating a user takes effect on their next request**, not at the end of
their session — `getSession` checks `isActive` every time. Staff leave, and the
expectation when someone is deactivated is that they lose access now.

**Users are deactivated, never deleted.** A deleted user makes years of clinical
history say "unknown".

**`logout` is public.** Logging out with an expired session should succeed
quietly rather than 401 — the caller wants to end up signed out either way.

**`Cache-Control: no-store` on the whole router.** Express ETags make `/me` and
`/status` answer 304, and a cached `needsSetup: true` would offer the setup
screen to a hospital that already has an owner.

## What is still placeholder

`role` is a string column with `'owner' | 'staff'`, and `requireOwner` in
`lib/session.js` compares against it. A hospital needs receptionists, triage
nurses, doctors, lab scientists, pharmacists, cashiers, records officers, HR and
a medical director, with permissions varying by department and ward.

Milestone 04 replaces both with `Role` and `Permission` tables and
`requirePermission('patient.register')`. The middleware **shape** stays as it
is, so call sites will not move.

## Not here yet

Every function in `service.js` is a place the audit log attaches — login, failed
login, logout, password change. Milestone 04 wraps them in one place rather than
scattering calls through the routes.
