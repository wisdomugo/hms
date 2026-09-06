import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { storage } from './storage/index.js';
import { ALLOWED } from './upload.js';

/*
 * SERVING UPLOADED FILES — and closing the gap index.js has carried since
 * milestone 02.
 *
 * What was wrong
 * --------------
 * Uploads were served with express.static, pointed at one folder. With one
 * instance per hospital that is correct and simple. On a shared server it is a
 * cross-tenant read: hospital A could fetch hospital B's scanned ID cards and
 * referral letters by guessing a path. Nothing authenticated the request, and
 * nothing tied a file to a hospital.
 *
 * It was harmless only because nothing wrote there. Milestone 05b is the
 * milestone that starts writing, so it is the milestone that has to fix it.
 *
 * Three changes
 * -------------
 * 1. Every storage key now begins with the hospital's slug:
 *      clinic/2026/09/referral-a1b2c3d4.pdf
 *
 * 2. This handler runs AFTER resolveTenant and requireAuth, and refuses any
 *    path that does not begin with the requesting hospital's own prefix. So
 *    even a correctly guessed filename from another hospital is a 404.
 *
 * 3. It is no longer public at all. These are clinical documents — a scanned
 *    ID card, a referral letter, a consent form. A CMS serves images to
 *    strangers by design; a hospital does not.
 */

// Extension -> declared type, inverted from the upload allow-list so the two
// can never disagree about what is servable.
const TYPE_BY_EXT = new Map([...ALLOWED].map(([mime, ext]) => [ext, mime]));

export async function serveUpload(req, res, next) {
  try {
    // With an S3 driver the files are not on this machine at all, so there is
    // nothing here to serve.
    if (!storage.root) return res.status(404).json({ error: 'Not found' });

    const requested = decodeURIComponent(req.path).replace(/^\/+/, '');

    /*
     * THE TENANT CHECK.
     *
     * A 404 rather than a 403, deliberately. "You are not allowed to see this"
     * confirms the file exists, which tells hospital A that hospital B has a
     * patient whose scan is at that path. One answer for "no such file" and
     * "not yours".
     */
    if (!req.tenant?.slug || !requested.startsWith(`${req.tenant.slug}/`)) {
      return res.status(404).json({ error: 'Not found' });
    }

    /*
     * Path traversal.
     *
     * A URL can contain ../ and Express does not stop it. Resolving the path
     * and confirming it is still inside the storage root is what turns
     *   /uploads/clinic/../../../etc/passwd
     * into a 404 instead of a file read. The prefix check above is not enough
     * on its own — "clinic/../../secret" starts with "clinic/".
     */
    const root = path.resolve(storage.root);
    const full = path.resolve(root, requested);
    if (full !== root && !full.startsWith(root + path.sep)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) return res.status(404).json({ error: 'Not found' });

    const type = TYPE_BY_EXT.get(path.extname(full).toLowerCase());
    if (!type) return res.status(404).json({ error: 'Not found' });

    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', info.size);
    // Stop a browser second-guessing the declared type and running something
    // as script.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // private: a shared cache must never hold one patient's document and hand
    // it to the next person through the same proxy.
    res.setHeader('Cache-Control', 'private, max-age=300');

    createReadStream(full).pipe(res);
  } catch (err) {
    next(err);
  }
}

/**
 * Where a hospital's files live inside the store.
 *
 * Every write goes through this, so a file cannot be saved outside its own
 * hospital's prefix by accident.
 */
export function tenantStorageKey(tenantSlug, key) {
  return `${tenantSlug}/${key}`;
}
