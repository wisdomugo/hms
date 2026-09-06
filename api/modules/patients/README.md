# modules/patients

Module 01 — Patient Registration. The hospital's single source of truth for who
a person is.

## The rule everything here is shaped by

From the workflow document, stated twice and in bold terms:

> No compulsory data validations are enforced; fields may save as null to
> prevent data fabrication if details are missing or unknown.

This is the right call, and it is not a small one. A receptionist facing a
required field she cannot fill will type *something* — a full stop, "unknown", a
guess at a surname. That guess then looks exactly like data for the next fifteen
years, and no later process can tell it from the real thing. **An empty field is
honest. A fabricated one is not.**

Four consequences, each designed for rather than discovered:

**1. Almost every column is nullable, including `surname`.** `schema.js`
validates *format when a value is present* and never *presence*. There is no
`.min(1)` on a name. What is still enforced is shape — a date that is a date, a
sex from the list — because refusing "1st Jan" in a date column forces nobody to
invent anything.

**2. The MRN is the only identity.** With every field optional there is no
natural key, so the number is always server-generated and never absent.

**3. Duplicate detection is advisory and never blocks.** `check-duplicates`
scores candidates and hands them back with reasons. Blocking would push staff
into inventing a middle name to get past the screen — the exact fabrication the
rule exists to prevent. The response says `advisory: true` so nobody wiring a
client is in any doubt.

**4. Incomplete is the normal state.** So there is a completeness score and a
reconciliation worklist, rather than validation at the point of entry. Chasing a
missing date of birth afterwards is a workflow; refusing the registration is a
fabrication generator.

## The MRN

`CLI/2026/00042-7` — prefix, year of registration, five-digit serial resetting
each January, check digit.

Nothing encodable that can change. Department, sex and payer type were all
considered and rejected: encode them and you get patients whose number says
"paediatrics" fifteen years later, and staff who trust the number over the
record. Year of registration is safe because it is a fact that never changes
about that person.

**The check digit is ISO 7064 MOD 11,10.** Staff transcribe these by hand from a
paper folder onto specimen bottles and request forms; MOD 11,10 catches every
single-digit error and every adjacent transposition, which is exactly what
copying by eye gets wrong. Chosen over plain mod-11 because it always yields a
decimal digit — plain mod-11 produces a remainder of 10 about one time in
eleven, which has to be written `X`, and a hospital number that sometimes ends
in a letter causes arguments at the records window forever.

**It cannot change once the first number is issued.** Every MRN already printed
on a folder would stop validating.

`mrnSearch` stores the same number with prefix and separators stripped, because
a receptionist reading a folder aloud types the digits, not the slashes.

## The emergency path

The red button takes sex and estimated age — and even those are optional,
because it exists to be pressed before anyone has looked properly. It issues a
`TEMP-0043` number, deliberately a different shape: short, always prefixed, no
year, no check digit. It has to be impossible to mistake for an MRN in both
directions.

The record goes in the **same `Patient` table** with `identityStatus:
'temporary'`, not a separate one. Reconciliation is then an update, not a
migration between tables with an unknown number of rows already pointing at the
old id.

On reconciliation the patient gets a real MRN and the `TEMP-` number moves into
`PatientIdentifier` as type `temp-id`. The wristband, the ER paperwork and the
specimen bottles all still carry it — losing it would mean a lab result arriving
next week with no patient to attach to.

## Merging, not deleting

Duplicate registration is the commonest real problem in a records room. The
losing record is never deleted: it stays, pointing at the survivor, because the
paper folder with that number on the cover is still on a shelf and someone will
bring it to the window next year. Its MRN also becomes a `legacy-folder`
identifier on the survivor, so the old number still finds the right person.

`PatientMerge` stores a snapshot of the losing record. It is the only place in
this schema that copies patient fields, and it exists because **an incorrect
merge is otherwise unrecoverable.**

## Audit

`patient.viewed` is the important one, and the one most hospital systems leave
out. Registering and editing get logged everywhere; **looking** is how a
confidentiality breach actually happens. Nobody edits a neighbour's file — they
open it.

Two things are deliberately kept out of the log:

- **The search term.** The result count is enough to show someone was looking. A
  patient's name in a log more people can read than can read the record is the
  exact widening the audit rules forbid.
- **Old and new values on an edit.** Field *names* only. Values in an audit log
  are patient data by another route.

A registration records which possible duplicates the receptionist was shown and
decided against. If a duplicate surfaces next year, that is the difference
between an oversight and a judgement.

## Money, from day one

`PatientPayer` captures the financial tier — self, HMO, NHIS or corporate — at
registration rather than at the cash desk, because the workflow document puts it
there and because modules 08 and 16 need it to pick a price list.

`Visit.payerSnapshot` copies the payer that applied on that day rather than
referencing it. The patient changes HMO next year; this visit must still bill
the way it was billed at the time, and still read correctly in an audit. This is
the snapshot rule the whole system uses, in its first real application.

## Not here yet

Attachments — scanned ID cards, referral letters, consent forms. The model
exists; the upload path comes with 05b, together with closing the cross-tenant
`/uploads` gap that `index.js` has been carrying since milestone 02.

Search is `contains`, not fuzzy. `pg_trgm` would catch "Adewale" against
"Adewalé" and the transpositions people actually type, and it is worth adding
once there is enough real data to tune a threshold against.

Every route is `requireAuth` and nothing finer. Milestone 06 puts
`requirePermission('patient.register')` and friends in front of them.
