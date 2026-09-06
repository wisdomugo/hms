/*
 * Identity numbers.
 *
 * MRNs today; invoice, receipt and lab accession numbers later. All share the
 * same three properties, and all are generated HERE rather than at a call site,
 * so those properties hold everywhere.
 *
 *   Unique      — enforced by the database, not by hope
 *   Permanent   — once issued, never changes for that person or transaction
 *   Never reused — including after a merge, a void or a death
 */

// ---------------------------------------------------------------------------
// Check digit — ISO 7064 MOD 11,10
//
// One extra digit computed from the others, so a mistyped number can be
// rejected the moment it is entered rather than becoming a wrong result.
//
// Staff transcribe these by hand from a paper folder onto specimen bottles and
// request forms. MOD 11,10 catches every single-digit error and every
// transposition of adjacent digits — which is precisely the failure mode of
// copying a number by eye.
//
// Chosen over plain mod-11 because it always yields a decimal digit. Plain
// mod-11 produces a remainder of 10 about one time in eleven, which has to be
// written as 'X' — and a hospital number that sometimes ends in a letter causes
// arguments at the records window forever.
//
// IT CANNOT CHANGE ONCE THE FIRST NUMBER IS ISSUED. Every MRN already printed
// on a folder would stop validating.
// ---------------------------------------------------------------------------
export function checkDigit(digits) {
  let p = 10;

  for (const char of String(digits)) {
    const d = Number(char);
    if (Number.isNaN(d)) continue;

    let s = (p + d) % 10;
    if (s === 0) s = 10;
    p = (2 * s) % 11;
  }

  return (11 - p) % 10;
}

export function isValidCheckDigit(digits, supplied) {
  return checkDigit(digits) === Number(supplied);
}

// ---------------------------------------------------------------------------
// The counter
//
// A single statement: insert the row if it is missing, otherwise increment it,
// and return the new value either way. Atomic in Postgres, so two receptionists
// pressing Register at the same instant cannot be handed the same number.
//
// Doing this as read-then-write in application code would be a race that
// appears roughly never in testing and roughly weekly in a busy records
// department.
// ---------------------------------------------------------------------------
export async function nextInSequence(client, key) {
  const rows = await client.$queryRaw`
    INSERT INTO "Counter" ("key", "value")
    VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"
  `;
  return rows[0].value;
}

// ---------------------------------------------------------------------------
// MRN
//
// Format:  PREFIX/YYYY/NNNNN-C     e.g.  CLI/2026/00042-7
//
//   PREFIX  per hospital, from the "mrn" Setting
//   YYYY    the year of REGISTRATION — safe to encode because it is a fact
//           that never changes about that patient
//   NNNNN   five digits, resetting each January, which keeps the counter
//           comfortable for the life of any hospital
//   C       the check digit, computed from YYYYNNNNN
//
// Nothing here encodes anything that can change. Department, sex and payer type
// were all considered and rejected: encode them and you get patients whose
// number says "paediatrics" fifteen years later, and staff who trust the number
// over the record.
// ---------------------------------------------------------------------------

const DEFAULT_MRN = { prefix: 'HMS', resetYearly: true, pad: 5 };

export async function mrnSettings(client) {
  const row = await client.setting.findUnique({ where: { key: 'mrn' } });
  return { ...DEFAULT_MRN, ...(row?.value ?? {}) };
}

/**
 * Issue the next MRN.
 *
 * Pass a transaction handle as `client` when registering, so the number and the
 * patient row commit together. A number issued to a registration that then
 * failed is a gap in the sequence — harmless, but it makes the records officer
 * wonder what happened to patient 41.
 */
export async function nextMrn(client, { at = new Date() } = {}) {
  const settings = await mrnSettings(client);

  const year = at.getFullYear();
  const key = settings.resetYearly ? `mrn:${year}` : 'mrn';

  const n = await nextInSequence(client, key);
  const serial = String(n).padStart(settings.pad, '0');

  // The digits the check digit is computed from, and the same string stored as
  // mrnSearch — so a receptionist who types the number without slashes finds
  // the patient.
  const digits = `${year}${serial}`;
  const check = checkDigit(digits);

  return {
    mrn: `${settings.prefix}/${year}/${serial}-${check}`,
    mrnSearch: `${digits}${check}`,
    serial: n,
    year
  };
}

/**
 * Temporary numbers, for the emergency path.
 *
 * Deliberately a different shape — short, always prefixed, no year, no check
 * digit. It has to be IMPOSSIBLE to mistake for an MRN, in both directions: a
 * temporary number must never be typed into a field expecting a real one, and a
 * glance at a wristband must say immediately that this file is unreconciled.
 */
export async function nextTemporaryId(client, { at = new Date() } = {}) {
  const n = await nextInSequence(client, `temp:${at.getFullYear()}`);
  const serial = String(n).padStart(4, '0');

  return {
    mrn: `TEMP-${serial}`,
    // Prefixed so it cannot collide with a real mrnSearch value, which is
    // always year-first.
    mrnSearch: `T${at.getFullYear()}${serial}`,
    serial: n
  };
}

/** Strip a typed number to the digits mrnSearch holds. */
export function normaliseNumber(input) {
  return String(input ?? '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// Visit numbers
//
// Not the patient's number. A visit number is per attendance, and the billing
// and queue modules key off it. Same counter mechanism, different sequence.
// ---------------------------------------------------------------------------
export async function nextVisitNumber(client, { at = new Date() } = {}) {
  const year = at.getFullYear();
  const n = await nextInSequence(client, `visit:${year}`);
  return `V${year}${String(n).padStart(6, '0')}`;
}
