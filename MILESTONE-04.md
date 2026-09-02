# Milestone 04 — the audit log

Already applied to the repo. Nothing here asks you to edit a file.

Small on purpose. It exists before Patient Registration because it is the one
thing that cannot be added retrospectively: permissions introduced later work
from that day forward, but a log introduced later has nothing to say about the
months before it.

## Files

**New**

```
api/lib/audit.js                  record(), auditRequest(), and the ACTIONS list
api/modules/audit/routes.js       read-only. No POST, no PATCH, no DELETE, ever
api/modules/audit/README.md
app/src/screens/Audit.jsx         the log, newest first, owner-only
```

**Modified**

```
api/prisma/schema.prisma          AuditEvent, and User.auditEvents
api/modules/auth/routes.js        eight events wired in
api/modules/auth/service.js       whoIs(), so logout knows who left
api/index.js                      mounts /api/audit
app/src/App.jsx                   Audit log in the sidebar, owner-only
app/src/app.css                   table, pill and chip styles
```

---

## Running it

```bash
cd api
npx prisma migrate dev --name add_audit --schema prisma/schema.prisma
npm run generate
npm run migrate:all
```

Restart both apps. The `generate` step is not optional — see DEV_GUIDE_03 §8.1.

---

## Verification

| # | Check | Expected |
|---|---|---|
| 1 | Sign out, then sign in | Audit log shows **Signed out** then **Signed in** |
| 2 | Sign in with a wrong password | a **failed** row, showing the email that was tried |
| 3 | Six wrong passwords | a **denied** `auth.login_locked` row after the fifth |
| 4 | Account → change password, wrong current | a **denied** row |
| 5 | Account → change password, correct | an **ok** row with `otherSessionsEnded` |
| 6 | `curl localhost:3000/api/health` | `migrations` is now **2** |
| 7 | Reload the page several times | **no new rows** — `/me` is deliberately not recorded |
| 8 | `curl localhost:3000/api/audit` with no cookie | 401 |

Check 7 is the one worth understanding. `/me` runs on every page load, and a log
where 95% of rows say "someone checked they were still signed in" is a log
nobody reads — which makes it worse than a smaller one. Volume is not
thoroughness.

Check 2 records the email that was *attempted*. That is a staff email, not
patient data, and it is the entire value of a failed-login entry: "someone is
trying this account" is the question it exists to answer.

---

## Two things written down rather than left in someone's head

**Append-only is enforced by the application, not yet by Postgres.** There is no
route that could write or edit an event. Proper enforcement is a database role
holding `INSERT` and `SELECT` but not `UPDATE` or `DELETE` on this table,
granted at deploy time. **Do this before the pilot hospital goes live.** It is
noted in `modules/audit/README.md` too.

**No patient data goes in the log. Ever.** Record that someone opened patient
402's record; never record their diagnosis or their phone number. `meta` holds
identifiers and field *names*, never field *values*.

The reason people miss: an audit log is read by more people than the records it
describes — administrators, auditors, whoever is investigating. Copying clinical
detail into it quietly widens who can see that detail. And an append-only table
is one nobody can correct, so anything sensitive that lands there stays there.

---

## Next

Milestone 05 — Patient Registration.

`patient.viewed` arrives with it, and it is the important one: **reading a record
is the commonest way a confidentiality breach actually happens.** Registering and
editing get logged everywhere; looking usually does not.

Before I write it I need two things from you:

1. **The MRN prefix** for a hospital — the `TAC` in `TAC/2026/00042-7`. It is a
   per-hospital setting, so I need a sensible default and where it comes from
   on onboarding.
2. **Confirmation of the check-digit algorithm.** I proposed mod-11 over Luhn:
   it catches more transposition errors, which is the error type that matters
   when a number is copied from a paper folder onto a specimen bottle. It cannot
   change once the first MRN is issued.
