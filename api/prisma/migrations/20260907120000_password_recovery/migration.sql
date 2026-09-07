-- Password recovery.
--
-- Until now the only way to change a password was to know the current one.
-- That is correct for a routine change and useless for the case that actually
-- happens: somebody forgot it. The hospital's owner account can now issue a
-- temporary password from the Staff screen, and set-password.mjs can do the
-- same over SSH for the case where the owner is the one locked out.
--
-- mustChangePassword marks a password that was issued by somebody else. The
-- API refuses every route except the password change while it is set, so a
-- password that has been read aloud over a telephone cannot survive the call.
--
-- Existing accounts default to false: they chose their own passwords.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
