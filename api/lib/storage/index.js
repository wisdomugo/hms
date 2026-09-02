import { localDriver } from './local.js';

// One interface, swappable by environment — same pattern as the cookie config.
// An S3 driver added later is a new file, not a rewrite:
//   save(buffer, storageKey, mimeType) -> { url }
//   remove(storageKey)
const drivers = {
  local: localDriver
};

const chosen = process.env.STORAGE_DRIVER || 'local';
export const storage = drivers[chosen];

if (!storage) {
  throw new Error(
    `Unknown STORAGE_DRIVER "${chosen}". Available: ${Object.keys(drivers).join(', ')}`
  );
}
