import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'uploads'
);

export const localDriver = {
  name: 'local',

  async save(buffer, storageKey, _mimeType) {
    const target = path.join(ROOT, storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return { url: `/uploads/${storageKey.split(path.sep).join('/')}` };
  },

  async remove(storageKey) {
    await unlink(path.join(ROOT, storageKey)).catch(() => {});
  },

  root: ROOT
};
