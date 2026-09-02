import multer from 'multer';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// SVG is deliberately excluded. An SVG can contain <script>, and these
// files are served from the same origin as the admin — so an uploaded
// SVG would be stored cross-site scripting.
export const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png',  '.png'],
  ['image/webp', '.webp'],
  ['image/gif',  '.gif'],
  ['application/pdf', '.pdf']
]);

/*
 * What the file ACTUALLY is, read from its leading bytes.
 *
 * multer's fileFilter can only check the Content-Type header, which the client
 * writes and can therefore lie about. That gap matters more than it looks:
 * image-size sniffs real bytes rather than trusting the header, so a file
 * declared image/png whose contents are ICNS, JXL or HEIF reaches parsers with
 * known infinite-loop bugs (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) for which
 * no fix is published.
 *
 * An infinite loop is not an exception, so wrapping the call in try/catch does
 * nothing — Node is single-threaded and the whole API stops answering.
 *
 * Checking the signature closes that, and incidentally means a file claiming to
 * be an image but containing something else is refused rather than stored.
 */
const SIGNATURES = [
  ['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/gif', b => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'))],
  ['image/webp', b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
  ['application/pdf', b => b.subarray(0, 5).toString('latin1') === '%PDF-']
];

export function sniffMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return SIGNATURES.find(([, test]) => test(buffer))?.[0] ?? null;
}

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  }
});

// The uploaded filename is NEVER used as a path. "../../.env" is a real
// attack, and two people uploading "photo.jpg" must not collide.
export function buildStorageKey(originalName, mimeType) {
  const ext = ALLOWED.get(mimeType) ?? path.extname(originalName).toLowerCase();

  const base = path
    .basename(originalName, path.extname(originalName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'file';

  const now = new Date();
  const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;

  return `${folder}/${base}-${randomBytes(4).toString('hex')}${ext}`;
}