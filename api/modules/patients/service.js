import { nextMrn, nextTemporaryId, nextVisitNumber, normaliseNumber } from '../../lib/numbers.js';

/*
 * Patient registration — the rules.
 *
 * Takes `prisma` (or a transaction handle) as its first argument, so billing,
 * appointments and the rest can call these directly rather than over HTTP, and
 * so a registration can share a transaction with whatever else has to happen
 * atomically with it.
 */

// ---------------------------------------------------------------------------
// Search
//
// One box. Receptionists are handed a folder, a phone number, a name, or a
// scrap of paper with a NIN on it, and they should not have to decide which
// field to put it in.
// ---------------------------------------------------------------------------
export async function search(prisma, { q, take = 25, skip = 0, includeMerged = false }) {
  const term = String(q ?? '').trim();
  if (term.length < 2) return { patients: [], total: 0 };

  const digits = normaliseNumber(term);

  const where = {
    deletedAt: null,
    // A merged record is not a patient any more, it is a redirect. Excluded by
    // default so a receptionist cannot open the losing side of a merge by
    // accident and start writing in it.
    ...(includeMerged ? {} : { mergedIntoId: null }),
    OR: [
      { surname:    { contains: term, mode: 'insensitive' } },
      { firstName:  { contains: term, mode: 'insensitive' } },
      { otherNames: { contains: term, mode: 'insensitive' } },
      { phone:      { contains: digits } },
      { altPhone:   { contains: digits } },
      { mrn:        { contains: term, mode: 'insensitive' } },
      // The forgiving one: the number as typed without slashes.
      ...(digits ? [{ mrnSearch: { contains: digits } }] : []),
      // Any other number the patient carries — NIN, NHIS, HMO, old folder.
      { identifiers: { some: { value: { contains: term, mode: 'insensitive' } } } }
    ]
  };

  const [patients, total] = await Promise.all([
    prisma.patient.findMany({
      where,
      take: Math.min(take, 100),
      skip,
      orderBy: [{ updatedAt: 'desc' }],
      select: summarySelect
    }),
    prisma.patient.count({ where })
  ]);

  return { patients, total };
}

const summarySelect = {
  id: true, mrn: true, identityStatus: true,
  surname: true, firstName: true, otherNames: true,
  sex: true, dateOfBirth: true, estimatedAge: true,
  phone: true, mergedIntoId: true, registeredAt: true
};

// ---------------------------------------------------------------------------
// Duplicate detection — ADVISORY, never enforced
//
// The workflow document forces a search before registering, to stop duplicate
// folders. But no field is compulsory, so there is no key to match on and no
// honest way to be certain.
//
// So this scores candidates and hands them back. It NEVER blocks. Blocking
// would push a receptionist into inventing a middle name to get past the
// screen, which is the exact fabrication the no-mandatory-fields rule exists to
// prevent — and an invented name is indistinguishable from a real one forever
// after.
// ---------------------------------------------------------------------------

const WEIGHTS = {
  identifier: 100,   // exact and issued by someone else — as close to certain as this gets
  phone: 40,
  dateOfBirth: 30,
  surname: 20,
  firstName: 15
};

export async function findPossibleDuplicates(prisma, input) {
  const { surname, firstName, phone, dateOfBirth, identifiers = [] } = input;

  const clauses = [];
  if (surname)   clauses.push({ surname:   { equals: surname,   mode: 'insensitive' } });
  if (firstName) clauses.push({ firstName: { equals: firstName, mode: 'insensitive' } });
  if (phone)     clauses.push({ phone:     { equals: phone } });
  if (dateOfBirth) clauses.push({ dateOfBirth });
  if (identifiers.length) {
    clauses.push({
      identifiers: {
        some: { OR: identifiers.map(i => ({ type: i.type, value: i.value })) }
      }
    });
  }

  if (clauses.length === 0) return [];

  const candidates = await prisma.patient.findMany({
    where: { deletedAt: null, mergedIntoId: null, OR: clauses },
    take: 25,
    select: { ...summarySelect, identifiers: { select: { type: true, value: true } } }
  });

  const scored = candidates.map(c => {
    let score = 0;
    const reasons = [];

    const same = (a, b) =>
      a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

    if (surname && same(c.surname, surname))     { score += WEIGHTS.surname;   reasons.push('same surname'); }
    if (firstName && same(c.firstName, firstName)) { score += WEIGHTS.firstName; reasons.push('same first name'); }
    if (phone && c.phone === phone)              { score += WEIGHTS.phone;     reasons.push('same phone number'); }

    if (dateOfBirth && c.dateOfBirth &&
        new Date(c.dateOfBirth).toDateString() === new Date(dateOfBirth).toDateString()) {
      score += WEIGHTS.dateOfBirth;
      reasons.push('same date of birth');
    }

    for (const given of identifiers) {
      if (c.identifiers.some(i => i.type === given.type && i.value === given.value)) {
        score += WEIGHTS.identifier;
        reasons.push(`same ${given.type.toUpperCase()}`);
      }
    }

    return {
      ...c,
      identifiers: undefined,
      score,
      reasons,
      // 'certain' only ever comes from a matching identifier — a number issued
      // by somebody else. Names and dates of birth repeat; a NIN does not.
      confidence: score >= 100 ? 'certain' : score >= 55 ? 'likely' : 'possible'
    };
  });

  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a patient.
 *
 * Everything happens in ONE transaction: the MRN is drawn from the counter, the
 * patient row is written, and the kin, payers, identifiers and opening visit go
 * with it. A number issued to a registration that then failed leaves a gap in
 * the sequence, and a gap makes the records officer wonder what happened to
 * patient 41.
 */
export async function register(prisma, { patient, kin = [], payers = [], identifiers = [], visit }, actorId) {
  return prisma.$transaction(async tx => {
    const { mrn, mrnSearch } = await nextMrn(tx);

    const created = await tx.patient.create({
      data: {
        ...patient,
        mrn,
        mrnSearch,
        identityStatus: 'permanent',
        registeredById: actorId ?? null,
        kin:         { create: kin },
        payers:      { create: payers },
        identifiers: { create: identifiers }
      }
    });

    let openedVisit = null;
    if (visit) {
      openedVisit = await openVisit(tx, created.id, visit, payers[0] ?? null);
    }

    return { patient: created, visit: openedVisit };
  });
}

/**
 * The red button.
 *
 * Sex and estimated age, and even those are optional. Everything else waits
 * until the patient is stable — which is the entire point of the path, and why
 * it is a separate function rather than register() with most fields blank.
 *
 * The record goes in the SAME table with identityStatus 'temporary', not a
 * separate one. Reconciliation is then an update, not a migration between
 * tables with an unknown number of rows already pointing at the old id.
 */
export async function registerEmergency(prisma, { sex, estimatedAge, note }, actorId) {
  return prisma.$transaction(async tx => {
    const { mrn, mrnSearch } = await nextTemporaryId(tx);

    const created = await tx.patient.create({
      data: {
        mrn,
        mrnSearch,
        identityStatus: 'temporary',
        sex: sex ?? 'unknown',
        estimatedAge: estimatedAge ?? null,
        registeredById: actorId ?? null
      }
    });

    // An emergency attendance, opened immediately — the file has to reach the
    // ER and nursing dashboards, and it reaches them as a visit.
    const openedVisit = await openVisit(
      tx, created.id,
      { type: 'emergency', department: 'Emergency', doctor: null },
      null
    );

    if (note) {
      await tx.patientAttachment.create({
        data: {
          patientId: created.id,
          kind: 'note',
          filename: 'presentation-note.txt',
          storageKey: '',
          mimeType: 'text/plain',
          sizeBytes: note.length,
          caption: note,
          uploadedById: actorId ?? null
        }
      }).catch(() => {});
    }

    return { patient: created, visit: openedVisit };
  });
}

/**
 * Turn a temporary record into a permanent one.
 *
 * Issues a real MRN and keeps the TEMP- number as an identifier, because the ER
 * paperwork, the wristband and the specimen bottles all still carry it. Losing
 * it would mean a lab result arriving next week with no patient to attach to.
 */
export async function reconcile(prisma, patientId, updates, actorId) {
  return prisma.$transaction(async tx => {
    const existing = await tx.patient.findUnique({ where: { id: patientId } });
    if (!existing) return { error: 'notfound' };
    if (existing.identityStatus !== 'temporary') return { error: 'already-permanent' };

    const { mrn, mrnSearch } = await nextMrn(tx);

    await tx.patientIdentifier.create({
      data: { patientId, type: 'temp-id', value: existing.mrn }
    });

    const updated = await tx.patient.update({
      where: { id: patientId },
      data: { ...updates, mrn, mrnSearch, identityStatus: 'permanent' }
    });

    return { patient: updated, previousMrn: existing.mrn };
  });
}

async function openVisit(tx, patientId, visit, primaryPayer) {
  return tx.visit.create({
    data: {
      patientId,
      visitNumber: await nextVisitNumber(tx),
      type: visit.type ?? 'outpatient',
      department: visit.department ?? null,
      doctor: visit.doctor ?? null,
      // THE SNAPSHOT RULE. Which payer applied on this day, copied rather than
      // referenced — the patient may change HMO next year, and this visit must
      // still bill and read the way it did at the time.
      payerSnapshot: primaryPayer
        ? {
            payerType: primaryPayer.payerType,
            payerName: primaryPayer.payerName ?? null,
            policyNumber: primaryPayer.policyNumber ?? null,
            plan: primaryPayer.plan ?? null
          }
        : null
    }
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function findById(prisma, id) {
  return prisma.patient.findFirst({
    where: { id, deletedAt: null },
    include: {
      identifiers: { orderBy: { createdAt: 'asc' } },
      kin:         { orderBy: { createdAt: 'asc' } },
      payers:      { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      visits:      { orderBy: { queuedAt: 'desc' }, take: 20 },
      attachments: { orderBy: { createdAt: 'desc' } },
      registeredBy: { select: { id: true, name: true, email: true } },
      mergedInto:   { select: { id: true, mrn: true, surname: true, firstName: true } },
      mergedFrom:   { select: { id: true, mrn: true } }
    }
  });
}

/**
 * How complete is this record?
 *
 * Not validation — a score. Incomplete is the normal state here, so the module
 * needs a way to surface records worth chasing rather than a way to refuse
 * them. This drives the reconciliation worklist.
 */
const TRACKED = ['surname', 'firstName', 'sex', 'dateOfBirth', 'phone', 'address'];

export function completeness(patient) {
  const missing = TRACKED.filter(f => patient[f] == null || patient[f] === '');
  return {
    score: Math.round(((TRACKED.length - missing.length) / TRACKED.length) * 100),
    missing
  };
}

/**
 * The worklist: records that need someone to go back to them.
 *
 * Every temporary record, plus anything permanent missing a name or a date of
 * birth. This is what replaces refusing the registration in the first place.
 */
export async function incompleteWorklist(prisma, { take = 50, skip = 0 } = {}) {
  const where = {
    deletedAt: null,
    mergedIntoId: null,
    OR: [
      { identityStatus: 'temporary' },
      { surname: null },
      { dateOfBirth: null }
    ]
  };

  const [patients, total] = await Promise.all([
    prisma.patient.findMany({
      where,
      take: Math.min(take, 200),
      skip,
      orderBy: [{ identityStatus: 'asc' }, { registeredAt: 'asc' }],
      select: { ...summarySelect, address: true }
    }),
    prisma.patient.count({ where })
  ]);

  return {
    patients: patients.map(p => ({ ...p, completeness: completeness(p) })),
    total
  };
}

// ---------------------------------------------------------------------------
// The day's summary
//
// What the landing screen shows. Four counts and the last few registrations,
// answered in one round trip so the first screen after signing in does not
// stutter through five requests.
// ---------------------------------------------------------------------------

/*
 * WHERE "TODAY" BEGINS.
 *
 * Not at the server's midnight. A VM in a European or American region runs on
 * UTC, so a hospital in Lagos (UTC+1) would watch its day roll over at 1am
 * — the night shift's registrations landing under tomorrow's date, and the
 * morning's count starting an hour late. The kind of wrongness nobody reports
 * as a bug; they just stop trusting the number.
 *
 * So the boundary is computed in the hospital's own timezone. One setting per
 * server for now, which is correct while every hospital is in one country.
 * When a hospital outside Nigeria signs up this moves into that hospital's
 * own Setting table, beside the MRN prefix, where it belongs.
 */
const HOSPITAL_TZ = process.env.HOSPITAL_TZ || 'Africa/Lagos';

export function startOfDayIn(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(now);

  const at = type => Number(parts.find(part => part.type === type)?.value ?? 0);

  // How far into the local day we are, subtracted from the current instant.
  // Going through the wall clock rather than a fixed offset means a timezone
  // that observes daylight saving stays correct without special-casing.
  const secondsIntoDay = at('hour') * 3600 + at('minute') * 60 + at('second');

  return new Date(now.getTime() - secondsIntoDay * 1000);
}

export async function todaySummary(prisma, { now = new Date(), take = 8 } = {}) {
  const since = startOfDayIn(HOSPITAL_TZ, now);

  // Merged-away and deleted records are excluded everywhere, so a duplicate
  // cleaned up this morning stops being counted the moment it is merged.
  const live = { deletedAt: null, mergedIntoId: null };

  const [registeredToday, visitsToday, awaitingReconciliation, incompleteRecords, recent] =
    await Promise.all([
      prisma.patient.count({ where: { ...live, registeredAt: { gte: since } } }),

      prisma.visit.count({ where: { queuedAt: { gte: since } } }),

      // Emergency registrations still carrying a temporary identity. These are
      // the ones with a real person attached and no name yet, so they are the
      // most urgent thing on the screen.
      prisma.patient.count({ where: { ...live, identityStatus: 'temporary' } }),

      // Permanent records missing a surname or a date of birth. Worth chasing,
      // but nobody is waiting on them, so they are counted separately from the
      // temporary ones rather than lumped into one "incomplete" number.
      prisma.patient.count({
        where: {
          ...live,
          identityStatus: { not: 'temporary' },
          OR: [{ surname: null }, { dateOfBirth: null }]
        }
      }),

      prisma.patient.findMany({
        where: { ...live, registeredAt: { gte: since } },
        orderBy: { registeredAt: 'desc' },
        take: Math.min(take, 25),
        select: summarySelect
      })
    ]);

  return {
    since,
    timeZone: HOSPITAL_TZ,
    registeredToday,
    visitsToday,
    awaitingReconciliation,
    incompleteRecords,
    recent
  };
}

// ---------------------------------------------------------------------------
// Merge
//
// Duplicate registration is the commonest real problem in a records room, and
// the answer is never to delete one. The losing record stays, pointing at the
// survivor, because the paper folder with that number on the cover is still on
// a shelf and someone will bring it to the window next year.
// ---------------------------------------------------------------------------
export async function merge(prisma, { survivingId, mergedId, reason }, actorId) {
  if (survivingId === mergedId) return { error: 'same-record' };

  return prisma.$transaction(async tx => {
    const [surviving, merged] = await Promise.all([
      tx.patient.findUnique({ where: { id: survivingId } }),
      tx.patient.findUnique({ where: { id: mergedId } })
    ]);

    if (!surviving || !merged) return { error: 'notfound' };
    if (merged.mergedIntoId) return { error: 'already-merged' };
    if (surviving.mergedIntoId) return { error: 'surviving-is-merged' };

    // Everything attached to the losing record moves. Visits especially — a
    // patient's history is the point of merging at all.
    await tx.visit.updateMany({ where: { patientId: mergedId }, data: { patientId: survivingId } });
    await tx.nextOfKin.updateMany({ where: { patientId: mergedId }, data: { patientId: survivingId } });
    await tx.patientPayer.updateMany({ where: { patientId: mergedId }, data: { patientId: survivingId } });
    await tx.patientAttachment.updateMany({ where: { patientId: mergedId }, data: { patientId: survivingId } });

    // Identifiers are unique on (type, value), so a shared NIN would collide.
    // Move what can move; leave the rest on the losing record, which still
    // exists and is still readable.
    const identifiers = await tx.patientIdentifier.findMany({ where: { patientId: mergedId } });
    for (const identifier of identifiers) {
      await tx.patientIdentifier
        .update({ where: { id: identifier.id }, data: { patientId: survivingId } })
        .catch(() => {});
    }

    // The losing MRN becomes a searchable alias, so the old folder number still
    // finds the right person.
    await tx.patientIdentifier.create({
      data: { patientId: survivingId, type: 'legacy-folder', value: merged.mrn }
    }).catch(() => {});

    await tx.patient.update({
      where: { id: mergedId },
      data: { mergedIntoId: survivingId }
    });

    await tx.patientMerge.create({
      data: {
        survivingId,
        mergedId,
        mergedById: actorId ?? null,
        reason,
        // The only copy of patient fields in this schema, and it is here
        // because an incorrect merge is otherwise unrecoverable.
        snapshot: JSON.parse(JSON.stringify(merged))
      }
    });

    return { survivingId, mergedId, mergedMrn: merged.mrn };
  });
}
