import express from 'express';
import { requireAuth } from '../../lib/session.js';
import { auditRequest, ACTIONS } from '../../lib/audit.js';
import { nextVisitNumber } from '../../lib/numbers.js';
import * as patients from './service.js';
import * as V from './schema.js';
import { registerAttachmentRoutes, attachmentView } from './attachments.js';

const router = express.Router();

/*
 * Every route here is guarded — mounted behind requireAuth in index.js. There
 * is no public patient endpoint and there never will be; the patient portal at
 * some later milestone gets its own module, scoped to the signed-in patient.
 */

const asInt = value => {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

// ---------------------------------------------------------------------------
// GET /api/patients?q=
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const result = await patients.search(req.prisma, {
      q: req.query.q,
      take: Number(req.query.take) || 25,
      skip: Number(req.query.skip) || 0
    });

    /*
     * Searching is recorded, and the query text is NOT.
     *
     * The count is enough to show that someone was looking. The term itself
     * would be a patient's name sitting in a log that more people can read than
     * can read the record — which is exactly the widening the audit rules
     * forbid.
     */
    await auditRequest(req, {
      action: ACTIONS.PATIENT_SEARCHED,
      meta: { results: result.total }
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/patients/check-duplicates
//
// Advisory. Called as the form is filled in, and it never blocks anything.
// ---------------------------------------------------------------------------
router.post('/check-duplicates', async (req, res, next) => {
  try {
    const parsed = V.duplicateQuery.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(V.problems(parsed));

    const candidates = await patients.findPossibleDuplicates(req.prisma, parsed.data);

    res.json({
      candidates,
      // Said explicitly in the response, because a client author reading this
      // endpoint should be in no doubt: nothing here stops a registration.
      advisory: true,
      message: candidates.length
        ? 'Possible existing records. Check before registering a new one.'
        : 'No similar records found.'
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/patients   — register
// ---------------------------------------------------------------------------
router.post('/', async (req, res, next) => {
  try {
    const parsed = V.registerPatient.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(V.problems(parsed));

    const { acknowledgedDuplicates, ...payload } = parsed.data;

    const { patient, visit } = await patients.register(req.prisma, payload, req.user.id);

    await auditRequest(req, {
      action: ACTIONS.PATIENT_REGISTERED,
      entity: 'Patient',
      entityId: patient.id,
      meta: {
        mrn: patient.mrn,
        visitNumber: visit?.visitNumber ?? null,
        // Which records the receptionist was shown and decided were not this
        // person. If a duplicate is found next year, this says the check
        // happened and what was decided — which is the difference between an
        // oversight and a judgement.
        acknowledgedDuplicates: acknowledgedDuplicates ?? []
      }
    });

    res.status(201).json({ patient, visit });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'One of those identifiers already belongs to another patient.',
        detail: err.meta?.target
      });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/patients/emergency   — the red button
//
// Sex and estimated age. Nothing else, and even those are optional.
// ---------------------------------------------------------------------------
router.post('/emergency', async (req, res, next) => {
  try {
    const parsed = V.emergencyPatient.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(V.problems(parsed));

    const { patient, visit } = await patients.registerEmergency(
      req.prisma, parsed.data, req.user.id
    );

    await auditRequest(req, {
      action: ACTIONS.PATIENT_EMERGENCY,
      entity: 'Patient',
      entityId: patient.id,
      meta: { tempId: patient.mrn, visitNumber: visit.visitNumber }
    });

    res.status(201).json({ patient, visit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/worklists/incomplete — mounted separately in index.js
// ---------------------------------------------------------------------------
export async function worklist(req, res, next) {
  try {
    const result = await patients.incompleteWorklist(req.prisma, {
      take: Number(req.query.take) || 50,
      skip: Number(req.query.skip) || 0
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/patients/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const id = asInt(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Patient id must be an integer' });

    const patient = await patients.findById(req.prisma, id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    /*
     * THE MOST IMPORTANT AUDIT EVENT IN THE SYSTEM, and the one most hospital
     * systems leave out.
     *
     * Registering and editing get logged everywhere. Looking usually does not —
     * and reading a record is how a confidentiality breach actually happens.
     * Nobody edits a neighbour's file; they open it.
     */
    await auditRequest(req, {
      action: ACTIONS.PATIENT_VIEWED,
      entity: 'Patient',
      entityId: patient.id
    });

    res.json({
      // Attachments go out as URLs, never as storage keys — the key is
      // internal, and building the URL in one place means a future move to S3
      // changes attachmentView() and nothing else.
      patient: { ...patient, attachments: patient.attachments.map(attachmentView) },
      completeness: patients.completeness(patient)
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/patients/:id
//
// The whitelist is the zod schema: it accepts the editable fields and nothing
// else, so mrn, identityStatus, registeredAt, mergedIntoId and deletedAt are
// simply unreachable from here.
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res, next) => {
  try {
    const id = asInt(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Patient id must be an integer' });

    const parsed = V.updatePatient.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(V.problems(parsed));

    const existing = await req.prisma.patient.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Patient not found' });

    if (existing.mergedIntoId) {
      return res.status(409).json({
        error: 'This record was merged into another and cannot be edited.',
        mergedInto: existing.mergedIntoId
      });
    }

    const patient = await req.prisma.patient.update({ where: { id }, data: parsed.data });

    await auditRequest(req, {
      action: ACTIONS.PATIENT_UPDATED,
      entity: 'Patient',
      entityId: id,
      // FIELD NAMES ONLY. What changed, never what it changed from or to —
      // old and new values in an audit log are patient data by another route.
      meta: { fields: Object.keys(parsed.data) }
    });

    res.json({ patient });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/patients/:id/reconcile   — temporary becomes permanent
// ---------------------------------------------------------------------------
router.post('/:id/reconcile', async (req, res, next) => {
  try {
    const id = asInt(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Patient id must be an integer' });

    const parsed = V.updatePatient.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(V.problems(parsed));

    const result = await patients.reconcile(req.prisma, id, parsed.data, req.user.id);

    if (result.error === 'notfound') return res.status(404).json({ error: 'Patient not found' });
    if (result.error === 'already-permanent') {
      return res.status(409).json({ error: 'This record already has a permanent number.' });
    }

    await auditRequest(req, {
      action: ACTIONS.PATIENT_RECONCILED,
      entity: 'Patient',
      entityId: id,
      meta: { previousMrn: result.previousMrn, mrn: result.patient.mrn }
    });

    res.json({ patient: result.patient, previousMrn: result.previousMrn });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Attaching things to a patient
//
// Each of these checks the patient exists and is not merged before writing.
// The foreign key proves the row exists; it cannot prove the row should be
// receiving this.
// ---------------------------------------------------------------------------
async function livePatient(req, res) {
  const id = asInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Patient id must be an integer' });
    return null;
  }

  const patient = await req.prisma.patient.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, mergedIntoId: true }
  });

  if (!patient) {
    res.status(404).json({ error: 'Patient not found' });
    return null;
  }
  if (patient.mergedIntoId) {
    res.status(409).json({
      error: 'This record was merged into another. Add it to the surviving record instead.',
      mergedInto: patient.mergedIntoId
    });
    return null;
  }

  return patient;
}

function attachRoute(path, schema, model, action) {
  router.post(`/:id/${path}`, async (req, res, next) => {
    try {
      const patient = await livePatient(req, res);
      if (!patient) return;

      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(V.problems(parsed));

      const row = await req.prisma[model].create({
        data: { ...parsed.data, patientId: patient.id }
      });

      await auditRequest(req, {
        action,
        entity: 'Patient',
        entityId: patient.id,
        meta: { added: path }
      });

      res.status(201).json({ [path]: row });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: 'That identifier already belongs to another patient.'
        });
      }
      next(err);
    }
  });
}

attachRoute('kin', V.nextOfKin, 'nextOfKin', ACTIONS.PATIENT_UPDATED);
attachRoute('payers', V.payer, 'patientPayer', ACTIONS.PATIENT_UPDATED);
attachRoute('identifiers', V.identifier, 'patientIdentifier', ACTIONS.PATIENT_UPDATED);

// ---------------------------------------------------------------------------
// POST /api/patients/:id/visits   — a returning patient
// ---------------------------------------------------------------------------
router.post('/:id/visits', async (req, res, next) => {
  try {
    const patient = await livePatient(req, res);
    if (!patient) return;

    const parsed = V.visit.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(V.problems(parsed));

    const primary = await req.prisma.patientPayer.findFirst({
      where: { patientId: patient.id, isPrimary: true },
      orderBy: { createdAt: 'desc' }
    });

    const visit = await req.prisma.$transaction(async tx => {
      return tx.visit.create({
        data: {
          patientId: patient.id,
          visitNumber: await nextVisitNumber(tx),
          type: parsed.data.type,
          department: parsed.data.department,
          doctor: parsed.data.doctor,
          // Snapshot, not a reference — see service.js.
          payerSnapshot: primary
            ? {
                payerType: primary.payerType,
                payerName: primary.payerName,
                policyNumber: primary.policyNumber,
                plan: primary.plan
              }
            : null
        }
      });
    });

    await auditRequest(req, {
      action: ACTIONS.VISIT_OPENED,
      entity: 'Patient',
      entityId: patient.id,
      meta: { visitNumber: visit.visitNumber, type: visit.type }
    });

    res.status(201).json({ visit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/patients/:id/merge
//
// :id is the SURVIVOR. The body names the record being absorbed.
// ---------------------------------------------------------------------------
router.post('/:id/merge', async (req, res, next) => {
  try {
    const survivingId = asInt(req.params.id);
    if (survivingId === null) return res.status(400).json({ error: 'Patient id must be an integer' });

    const parsed = V.mergeRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(V.problems(parsed));

    const result = await patients.merge(
      req.prisma,
      { survivingId, mergedId: parsed.data.mergedId, reason: parsed.data.reason },
      req.user.id
    );

    const refusals = {
      'same-record': 'A record cannot be merged into itself.',
      'notfound': 'One of those records does not exist.',
      'already-merged': 'That record has already been merged into another.',
      'surviving-is-merged': 'The surviving record has itself been merged into another. Merge into that one instead.'
    };

    if (result.error) {
      return res.status(result.error === 'notfound' ? 404 : 409).json({
        error: refusals[result.error]
      });
    }

    // Recorded against BOTH records, because "what happened to this file" has
    // to be answerable from either number — and the losing number is the one
    // written on the folder somebody will bring to the window.
    await auditRequest(req, {
      action: ACTIONS.PATIENT_MERGED,
      entity: 'Patient',
      entityId: result.survivingId,
      meta: { mergedId: result.mergedId, mergedMrn: result.mergedMrn, reason: parsed.data.reason }
    });
    await auditRequest(req, {
      action: ACTIONS.PATIENT_MERGED,
      entity: 'Patient',
      entityId: result.mergedId,
      meta: { intoId: result.survivingId, reason: parsed.data.reason }
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Attachments live in their own file: file handling brings its own concerns —
// multipart parsing, byte-signature checks, orphaned files — and mixing them in
// with registration logic makes both harder to read.
registerAttachmentRoutes(router, livePatient);

export default router;
