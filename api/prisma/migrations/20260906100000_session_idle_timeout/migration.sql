-- Idle-based session expiry.
--
-- Sessions used to die on a fixed clock: signed in at 07:00, gone at 19:00,
-- whether the person had been working all day or had gone home at noon leaving
-- the ward computer open.
--
-- lastSeenAt is stamped as the session is used, so an abandoned workstation
-- locks itself while a busy clerk is never interrupted. expiresAt stays as the
-- absolute ceiling, so a session cannot be kept alive forever.
--
-- Existing sessions get CURRENT_TIMESTAMP, which gives everyone signed in when
-- this is deployed a fresh idle window rather than logging the ward out mid-shift.

ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Session_lastSeenAt_idx" ON "Session"("lastSeenAt");
