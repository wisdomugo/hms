# modules/audit

Who did what, when. Read-only.

## Why it exists before the module it is for

Permissions decide who **may** act. The audit log records who **did**. They are
two halves of one question, and only one of them can be added later.

Permissions introduced in six months work perfectly from that day forward. An
audit log introduced in six months has nothing whatsoever to say about the six
months before it — and "who registered this patient in March" is not a question
you can answer retrospectively.

So it goes in before Patient Registration, not after.

## The one rule

**No patient data in the log. Ever.**

Record that someone opened patient 402's record. Never record their diagnosis,
their phone number, or the old and new values of a field they edited. `meta` is
for identifiers and field *names* — never field values.

Two reasons, and the second is the one people miss:

- An audit log is read by **more people** than the records it describes —
  administrators, auditors, whoever is investigating an incident. Copying
  clinical detail into it quietly widens who can see that detail.
- An append-only table is by definition one **nobody can correct**. Anything
  wrong or sensitive that lands in it stays there.

## Append-only

There is no `POST` here, no `PATCH`, no `DELETE`, and there never will be.
Events are written by `lib/audit.js` from inside the actions being recorded — an
endpoint that accepted events would let anything claim anything happened.

Today the *application* enforces that by having no route that could. Enforcing
it properly means a Postgres role with `INSERT` and `SELECT` but not `UPDATE` or
`DELETE` on this table, granted at deploy time. **That should be done before the
pilot hospital goes live**, and it is written here rather than left in someone's
head.

## What gets recorded, and what deliberately does not

Recorded from milestone 03's routes: login, failed login, lockout, logout,
password change, password change refused, setup completed, setup rejected.

**`GET /me` is not recorded.** It runs on every page load, and a log where 95%
of rows say "someone checked they were still signed in" is a log nobody reads —
which makes it worse than a smaller one. Volume is not thoroughness.

**Refused actions are recorded.** Often they matter more than successful ones. A
password change refused because the current password was wrong is what a
borrowed workstation looks like from the inside.

## Design notes

**`actorEmail` is a snapshot, not a convenience.** The `actor` relation is
`SetNull`, and staff change names and leave. The log has to stay readable years
later without depending on a row that has moved on. This is the same
snapshot-on-write rule the whole system uses for clinical and billing records.

**`entityId` is a string.** Patient ids are integers, Tenant ids are cuids. A
log that can only reference one kind of id is a log that stops being written the
first time that is inconvenient.

**Action names live in `ACTIONS` in `lib/audit.js`, never as literals at call
sites.** These are what every future query filters on — "show me every merge
this month", "who has been looking at this patient". A typo at a call site
becomes an event no report ever finds, and nothing fails to reveal it.

**A failed audit write does not fail the action** — outside a transaction it is
logged loudly and swallowed. A hospital where nobody can register a patient
because the audit table is full is worse than one with a visible gap in its log.
Where losing an event is genuinely unacceptable — a payment, a drug
administration, a merge — pass the transaction handle to `record()` so the
action and its record commit together or not at all.

## Coming with milestone 05

`patient.viewed` is the important one, and the one most systems leave out:
**reading a record is the commonest way a confidentiality breach actually
happens.** Registering and editing get logged everywhere; looking is what
usually does not.

## Coming with milestone 06

`requireOwner` on this router becomes `requirePermission('audit.read')` — a
permission very few roles should carry. The log names who did what, and reading
it is itself an act worth controlling.
