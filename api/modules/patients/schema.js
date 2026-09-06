import { z } from 'zod';

/*
 * Validation for patient registration.
 *
 * THE GOVERNING RULE, from the Module 01 workflow document:
 *
 *   "No compulsory data validations are enforced; fields may save as null to
 *    prevent data fabrication if details are missing or unknown."
 *
 * So this file validates FORMAT WHEN A VALUE IS PRESENT, and never presence.
 * Almost everything is .optional().nullable(). There is no .min(1) on a name.
 *
 * That is the exact inverse of the form validation in a normal application, and
 * it is worth being explicit about why: a receptionist facing a required field
 * she cannot fill will type something — a full stop, "unknown", a guess at a
 * surname. That guess then looks exactly like data for the next fifteen years.
 * An empty field is honest; a fabricated one is not, and no later process can
 * tell them apart.
 *
 * What IS enforced is shape: a date that is a date, a phone that looks like a
 * phone, a sex from the list. Refusing "1st Jan" in a date column is not
 * forcing anyone to invent anything.
 */

// Trim, and turn empty strings into null. A form posts "" for every untouched
// field, and "" stored in a nullable column is a value — it looks filled in
// when it is not, and every later `IS NULL` check misses it.
const text = (max = 200) =>
  z.string().trim().max(max).transform(v => (v === '' ? null : v)).nullable().optional();

// Nigerian numbers arrive as 08012345678, +2348012345678, 0801 234 5678.
// Punctuation is stripped; nothing is rejected for being the wrong length,
// because a patient may genuinely only remember part of a number and half a
// number is better than none.
const phone = z
  .string()
  .trim()
  .max(30)
  .transform(v => v.replace(/[^\d+]/g, ''))
  .transform(v => (v === '' ? null : v))
  .nullable()
  .optional();

const email = z
  .string()
  .trim()
  .max(200)
  .transform(v => (v === '' ? null : v))
  .nullable()
  .optional()
  .refine(v => v == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
    message: 'That email address does not look right'
  });

// A date, or nothing. Rejects a future date of birth, and anything implying an
// age over 130 — not to police the data, but because both are almost always a
// typed year gone wrong, and catching it at entry is cheaper than finding it
// in an age report later.
const pastDate = z
  .union([z.string(), z.date()])
  .transform(v => (v === '' ? null : v))
  .nullable()
  .optional()
  .transform(v => (v == null ? null : new Date(v)))
  .refine(v => v == null || !Number.isNaN(v.getTime()), { message: 'That is not a valid date' })
  .refine(v => v == null || v <= new Date(), { message: 'A date of birth cannot be in the future' })
  .refine(
    v => v == null || v >= new Date(Date.now() - 130 * 365.25 * 24 * 60 * 60 * 1000),
    { message: 'That date of birth implies an age over 130 — check the year' }
  );

const enumOrNull = (values, message) =>
  z.string().trim().toLowerCase()
    .transform(v => (v === '' ? null : v))
    .nullable().optional()
    .refine(v => v == null || values.includes(v), { message });

export const SEX = ['female', 'male', 'other', 'unknown'];
export const MARITAL = ['single', 'married', 'divorced', 'widowed', 'separated'];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const GENOTYPES = ['AA', 'AS', 'AC', 'SS', 'SC', 'CC'];
export const PAYER_TYPES = ['self', 'hmo', 'nhis', 'corporate'];
export const IDENTIFIER_TYPES = ['nin', 'nhis', 'hmo', 'passport', 'legacy-folder', 'temp-id'];

const bloodGroup = z.string().trim().toUpperCase()
  .transform(v => (v === '' ? null : v)).nullable().optional()
  .refine(v => v == null || BLOOD_GROUPS.includes(v), { message: 'Not a blood group' });

const genotype = z.string().trim().toUpperCase()
  .transform(v => (v === '' ? null : v)).nullable().optional()
  .refine(v => v == null || GENOTYPES.includes(v), { message: 'Not a genotype' });

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const patientCore = z.object({
  surname:    text(100),
  firstName:  text(100),
  otherNames: text(150),
  sex:        enumOrNull(SEX, `Sex must be one of: ${SEX.join(', ')}`),
  dateOfBirth: pastDate,
  estimatedAge: z.coerce.number().int().min(0).max(130).nullable().optional(),

  phone, altPhone: phone, email,
  address: text(300),
  city:    text(100),
  state:   text(100),

  nationality:   text(100),
  stateOfOrigin: text(100),
  maritalStatus: enumOrNull(MARITAL, `Marital status must be one of: ${MARITAL.join(', ')}`),
  occupation:    text(150),

  bloodGroup, genotype,
  knownAllergies: text(500),

  // Per-hospital custom fields. Shape comes from the "registration" Setting,
  // so it cannot be validated here beyond "it is an object".
  extra: z.record(z.string(), z.unknown()).nullable().optional()
}).strict();
//  ^^^^^^^^
// STRICT, and this is load-bearing.
//
// Zod's default is to STRIP a key it does not recognise. That is quietly wrong
// for a whitelist: PATCH {"mrn":"MINE/1"} would parse to {} and answer 200, so
// the caller believes they set the hospital number and nothing says otherwise.
// The MRN is safe either way, but silence is the wrong answer — the CMS this
// system borrows from names rejected fields in a 400, and so does this.
//
// It also catches the ordinary case: a misspelt "firstname" is refused rather
// than dropped, instead of being discovered months later as a column of nulls.

export const nextOfKin = z.object({
  name:         text(150),
  relationship: text(60),
  phone,
  address:      text(300),
  isEmergencyContact: z.boolean().optional().default(true),
  isGuarantor:        z.boolean().optional().default(false)
});

export const payer = z.object({
  payerType: z.string().trim().toLowerCase()
    .refine(v => PAYER_TYPES.includes(v), { message: `Payer type must be one of: ${PAYER_TYPES.join(', ')}` }),
  payerName:    text(150),
  policyNumber: text(80),
  plan:         text(80),
  validFrom:    pastDate.optional(),
  // The only date allowed to be in the future — a policy expiry is supposed to
  // be.
  validTo: z.union([z.string(), z.date()]).nullable().optional()
    .transform(v => (v == null || v === '' ? null : new Date(v)))
    .refine(v => v == null || !Number.isNaN(v.getTime()), { message: 'Not a valid date' }),
  isPrimary: z.boolean().optional().default(true)
});

export const identifier = z.object({
  type: z.string().trim().toLowerCase()
    .refine(v => IDENTIFIER_TYPES.includes(v), { message: `Type must be one of: ${IDENTIFIER_TYPES.join(', ')}` }),
  // The one genuinely required field in this module. An identifier with no
  // value is not an identifier, and storing one would break the uniqueness that
  // makes identifiers the strongest duplicate check available.
  value:  z.string().trim().min(1, 'An identifier needs a value').max(80),
  issuer: text(120)
});

export const visit = z.object({
  type:       z.string().trim().toLowerCase().default('outpatient'),
  department: text(120),
  doctor:     text(150)
});

export const registerPatient = z.object({
  patient:     patientCore,
  kin:         z.array(nextOfKin).max(5).optional(),
  payers:      z.array(payer).max(5).optional(),
  identifiers: z.array(identifier).max(10).optional(),
  // Registration normally creates a visit, because every path in the workflow
  // document ends in one. Omit it for a records-room migration of old paper
  // folders, where there is no attendance today.
  visit: visit.nullable().optional(),
  // Set when the receptionist has been shown possible duplicates and chosen to
  // continue anyway. Recorded on the audit entry — see service.js.
  acknowledgedDuplicates: z.array(z.number().int()).optional()
});

// The emergency path. Two fields, and even these are optional — the red button
// exists to be pressed before anyone has looked properly.
export const emergencyPatient = z.object({
  sex: enumOrNull(SEX, `Sex must be one of: ${SEX.join(', ')}`),
  estimatedAge: z.coerce.number().int().min(0).max(130).nullable().optional(),
  note: text(300)
});

// ---------------------------------------------------------------------------
// Editing
//
// A whitelist, and it excludes everything that must never be changed through
// the API: mrn, mrnSearch, identityStatus, registeredById, registeredAt,
// mergedIntoId, deletedAt.
// ---------------------------------------------------------------------------
export const updatePatient = patientCore.partial().strict();

export const mergeRequest = z.object({
  // The record being absorbed. The surviving one is the URL's patient.
  mergedId: z.number().int(),
  reason:   z.string().trim().min(3, 'Say why these are the same person').max(300)
});

export const duplicateQuery = z.object({
  surname:     text(100),
  firstName:   text(100),
  phone,
  dateOfBirth: pastDate,
  identifiers: z.array(identifier.pick({ type: true, value: true })).max(10).optional()
});

/**
 * Turn a zod failure into the error shape the rest of the API uses: the first
 * problem as `error`, all of them as `fields`, so a form can mark every bad
 * input at once instead of one per round trip.
 */
export function problems(result) {
  const fields = result.error.issues.flatMap(i => {
    // An unrecognised key carries its names in i.keys rather than i.path, so
    // without this the 400 would say "unrecognized keys" and not say which.
    if (i.code === 'unrecognized_keys') {
      return (i.keys ?? []).map(key => ({
        field: [...i.path, key].join('.'),
        message: `"${key}" is not a field you can set here`
      }));
    }
    return [{ field: i.path.join('.'), message: i.message }];
  });

  return {
    error: fields[0]?.message ?? 'That submission is not valid',
    fields
  };
}
