import { storage } from '../../lib/storage/index.js';
import { upload, buildStorageKey, sniffMimeType } from '../../lib/upload.js';
import { tenantStorageKey } from '../../lib/uploads-route.js';
import { auditRequest, ACTIONS } from '../../lib/audit.js';

/*
 * Patient attachments — scanned ID cards, referral letters, consent forms, and
 * photographs of old paper folders during a records migration.
 *
 * Kept in its own file rather than in routes.js because file handling brings
 * its own concerns — multipart parsing, byte-signature checks, orphaned files —
 * and mixing those in with registration logic makes both harder to read.
 */

const KINDS = ['id-card', 'referral', 'consent', 'old-folder', 'photo', 'other'];

/**
 * Turn a stored attachment row into something a browser can use.
 *
 * The storage key is internal; the URL is what the record screen renders. Kept
 * in one place so a future move to S3 changes this function and nothing else.
 */
export function attachmentView(row) {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    caption: row.caption,
    createdAt: row.createdAt,
    url: row.storageKey ? `/uploads/${row.storageKey}` : null
  };
}

export function registerAttachmentRoutes(router, livePatient) {
  // -------------------------------------------------------------------------
  // POST /api/patients/:id/attachments
  //
  // multipart/form-data:  file, kind, caption
  // -------------------------------------------------------------------------
  router.post('/:id/attachments', upload.single('file'), async (req, res, next) => {
    try {
      const patient = await livePatient(req, res);
      if (!patient) return;

      if (!req.file) {
        return res.status(400).json({ error: 'No file received. Send it as the "file" field.' });
      }

      const { originalname, mimetype, buffer, size } = req.file;

      /*
       * multer checked the Content-Type header, which the client writes and can
       * therefore lie about. This checks the actual leading bytes.
       *
       * It matters more here than it did in the CMS. A file claiming to be a
       * PDF that is really something else would sit in a patient's record, be
       * opened by a doctor, and be trusted because it is in the chart.
       */
      const actualType = sniffMimeType(buffer);
      if (actualType !== mimetype) {
        return res.status(415).json({
          error: actualType
            ? `That file is a ${actualType}, not a ${mimetype}. Scan or export it again.`
            : `That file's contents are not a recognised ${mimetype}.`
        });
      }

      const kind = String(req.body.kind ?? 'other').trim().toLowerCase();
      if (!KINDS.includes(kind)) {
        return res.status(400).json({ error: `Kind must be one of: ${KINDS.join(', ')}` });
      }

      // The hospital's own prefix. Every write goes through this, so a file
      // cannot land outside its hospital's folder by accident.
      const key = tenantStorageKey(req.tenant.slug, buildStorageKey(originalname, mimetype));

      await storage.save(buffer, key, mimetype);

      /*
       * File first, row second.
       *
       * If the row write fails we have an orphaned file, which is untidy and
       * invisible. The other order risks a row pointing at nothing, which is a
       * broken document in a patient's chart — and someone deciding a referral
       * letter was never received.
       */
      let row;
      try {
        row = await req.prisma.patientAttachment.create({
          data: {
            patientId: patient.id,
            kind,
            filename: originalname.slice(0, 200),
            storageKey: key,
            mimeType: mimetype,
            sizeBytes: size,
            caption: String(req.body.caption ?? '').trim().slice(0, 300) || null,
            uploadedById: req.user.id
          }
        });
      } catch (err) {
        // Do not leave a file nobody can reach.
        await storage.remove(key).catch(() => {});
        throw err;
      }

      await auditRequest(req, {
        action: ACTIONS.PATIENT_ATTACHMENT_ADDED,
        entity: 'Patient',
        entityId: patient.id,
        // The KIND of document, never the caption. A caption is written by a
        // person and will eventually contain something clinical.
        meta: { kind, sizeBytes: size, mimeType: mimetype }
      });

      res.status(201).json({ attachment: attachmentView(row) });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/patients/:id/attachments/:attachmentId
  //
  // For a mis-scan or a document attached to the wrong patient — which is a
  // confidentiality problem, so it has to be fixable.
  // -------------------------------------------------------------------------
  router.delete('/:id/attachments/:attachmentId', async (req, res, next) => {
    try {
      const patient = await livePatient(req, res);
      if (!patient) return;

      const attachmentId = Number(req.params.attachmentId);
      if (!Number.isInteger(attachmentId)) {
        return res.status(400).json({ error: 'Attachment id must be an integer' });
      }

      /*
       * Scoped to this patient, not looked up by id alone.
       *
       * The foreign key proves the attachment exists; it cannot prove it
       * belongs to the patient in the URL. Without this, attachment 91 could be
       * deleted through any patient's URL.
       */
      const row = await req.prisma.patientAttachment.findFirst({
        where: { id: attachmentId, patientId: patient.id }
      });
      if (!row) return res.status(404).json({ error: 'Attachment not found' });

      await req.prisma.patientAttachment.delete({ where: { id: row.id } });
      await storage.remove(row.storageKey).catch(() => {});

      await auditRequest(req, {
        action: ACTIONS.PATIENT_ATTACHMENT_REMOVED,
        entity: 'Patient',
        entityId: patient.id,
        meta: { kind: row.kind }
      });

      res.json({ deleted: { id: row.id, kind: row.kind } });
    } catch (err) {
      next(err);
    }
  });
}
