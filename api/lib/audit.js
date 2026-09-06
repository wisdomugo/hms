/*
 * THE AUDIT LOG.
 *
 * Permissions decide who MAY do something. This records who DID. They are two
 * halves of one question, and this is the half that cannot be added later —
 * permissions introduced in six months work perfectly from that day forward,
 * but an audit log introduced in six months has nothing to say about the six
 * months before it.
 *
 * Which is why this exists before the module it is for.
 */

/*
 * THE ONE RULE: no patient data in here.
 *
 * The audit log answers "who touched what, when". It does NOT hold what the
 * thing said. Record that someone opened patient 402's record; never record
 * their diagnosis, their phone number, or the old and new values of a field
 * they edited.
 *
 * Two reasons, and the second is the one people miss. An audit log is read by
 * more people than the records it describes — administrators, auditors, whoever
 * is investigating an incident — so copying clinical detail into it quietly
 * widens who can see that detail. And an append-only table is by definition one
 * nobody can correct, so anything wrong or sensitive that lands in it stays
 * there.
 *
 * `meta` is for identifiers and field NAMES. Never field values.
 */

/** Everything this module knows how to be told about a request. */
export function actorFrom(req) {
  return {
    actorId: req.user?.id ?? null,
    // Snapshotted, not just referenced. The relation is SetNull, and staff get
    // deactivated and change their names — the log has to stay readable years
    // later without joining to a row that may have moved on.
    actorEmail: req.user?.email ?? null,
    ip: req.ip ?? null,
    userAgent: req.get?.('user-agent')?.slice(0, 300) ?? null
  };
}

/**
 * Write one event.
 *
 * `client` is either req.prisma or a transaction handle. Passing a transaction
 * is what makes an event impossible to lose for the actions where that matters
 * — a payment, a drug administration, a merge. The action and its record then
 * commit together or not at all.
 *
 * Outside a transaction, a failure to write the audit row is logged loudly and
 * swallowed. That is a deliberate trade: a hospital where nobody can register a
 * patient because the audit table is full is worse than one with a gap in its
 * log, and the gap is at least visible in the server log.
 */
export async function record(client, event) {
  const row = {
    action: event.action,
    entity: event.entity ?? null,
    // String, not Int. Patient ids are integers, Tenant ids are cuids, and a
    // log that can only reference one kind of id is a log that stops being
    // written the first time that is inconvenient.
    entityId: event.entityId == null ? null : String(event.entityId),
    outcome: event.outcome ?? 'ok',
    actorId: event.actorId ?? null,
    actorEmail: event.actorEmail ?? null,
    ip: event.ip ?? null,
    userAgent: event.userAgent ?? null,
    meta: event.meta ?? undefined
  };

  try {
    await client.auditEvent.create({ data: row });
  } catch (err) {
    console.error('[audit] FAILED TO RECORD', row.action, err?.message ?? err);
  }
}

/**
 * The common case: record something about the request in hand.
 *
 * Pulls the actor, IP and user agent off req so a call site only has to say
 * what happened.
 */
export async function auditRequest(req, event) {
  return record(req.prisma, { ...actorFrom(req), ...event });
}

/*
 * Action names.
 *
 * Kept in one place rather than typed as strings at call sites, because these
 * are what every future query filters on — "show me every merge this month",
 * "who has been looking at this patient". A typo at a call site becomes an
 * event that no report ever finds, and nothing fails to reveal it.
 *
 * Shape: <area>.<verb>, lowercase, dot-separated. Add to this list; do not
 * invent names inline.
 */
export const ACTIONS = {
  // Authentication
  LOGIN: 'auth.login',
  LOGIN_FAILED: 'auth.login_failed',
  LOGIN_LOCKED: 'auth.login_locked',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password_changed',
  SETUP_COMPLETED: 'auth.setup_completed',
  SETUP_REJECTED: 'auth.setup_rejected',

  // Patients (milestone 05)
  //
  // PATIENT_VIEWED is the one that matters most and the one most hospital
  // systems leave out. Registering and editing get logged everywhere; LOOKING
  // is how a confidentiality breach actually happens — nobody edits a
  // neighbour's file, they open it.
  PATIENT_SEARCHED: 'patient.searched',
  PATIENT_VIEWED: 'patient.viewed',
  PATIENT_REGISTERED: 'patient.registered',
  PATIENT_EMERGENCY: 'patient.emergency_registered',
  PATIENT_UPDATED: 'patient.updated',
  PATIENT_RECONCILED: 'patient.reconciled',
  PATIENT_MERGED: 'patient.merged',
  VISIT_OPENED: 'visit.opened',

  // Documents. The KIND is recorded, never the caption — a caption is written
  // by a person and will eventually contain something clinical.
  PATIENT_ATTACHMENT_ADDED: 'patient.attachment_added',
  PATIENT_ATTACHMENT_REMOVED: 'patient.attachment_removed'
};
