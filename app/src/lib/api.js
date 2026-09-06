/*
 * One place that knows how to talk to the API.
 *
 * Without it every screen repeats the same six lines of fetch boilerplate, and
 * they drift — one forgets the Content-Type, another forgets to read the error
 * message and shows "Request failed" where the server sent something useful.
 */

export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    // The per-field problems from zod, so a form can mark every bad input at
    // once rather than one per round trip.
    this.fields = fields ?? [];
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const isForm = body instanceof FormData;

  const res = await fetch(path, {
    method,
    signal,
    // FormData sets its own Content-Type, including the multipart boundary.
    // Setting it by hand breaks the upload in a way that is genuinely hard to
    // debug — the request looks right and the server sees no file.
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: isForm ? body : body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.fields);
  }
  return data;
}

export const api = {
  get:    (path, opts)       => request(path, opts),
  post:   (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch:  (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts)       => request(path, { ...opts, method: 'DELETE' })
};

// ---------------------------------------------------------------------------
// Small shared formatters. Here rather than in each screen so a date looks the
// same on the search results as it does on the record.
// ---------------------------------------------------------------------------

export function fullName(p) {
  const name = [p.surname, p.firstName, p.otherNames].filter(Boolean).join(' ');
  // A patient with no name at all is normal here, not an error — so say
  // something honest rather than rendering an empty row.
  return name || 'Name not recorded';
}

export function age(patient) {
  if (patient.dateOfBirth) {
    const dob = new Date(patient.dateOfBirth);
    const now = new Date();
    let years = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--;
    return `${years}`;
  }
  // The emergency path records an estimate, and the display has to say which
  // it is — a guessed age and a known one are different facts.
  if (patient.estimatedAge != null) return `~${patient.estimatedAge}`;
  return '—';
}

export const shortDate = value =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) : '—';

export const dateTime = value =>
  value ? new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }) : '—';

export const bytes = n =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
