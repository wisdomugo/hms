-- Make "AuditEvent" append-only at the DATABASE level.
--
-- Until now this was enforced by the application simply having no route that
-- could update or delete an event. That stops the application, and nothing
-- else: anyone with a psql prompt could rewrite history in the one table whose
-- entire value is that it cannot be rewritten.
--
-- WHY A TRIGGER RATHER THAN A ROLE GRANT
--
-- The obvious alternative is a Postgres role holding INSERT and SELECT but not
-- UPDATE or DELETE on this table. That works, but it needs a second connection
-- string per hospital — one for migrations, one for the application — and it is
-- a manual step at deploy time. Manual steps get missed, and the hospital where
-- it is missed is the one nobody thinks about until an incident.
--
-- A trigger travels with the code. Every hospital gets it the moment
-- `migrate:all` runs, including hospitals onboarded next year, with nobody
-- having to remember anything.
--
-- WHAT THIS DOES AND DOES NOT PROTECT AGAINST
--
-- It stops the application, a mistaken query, and an ORM that decides to be
-- helpful. It does NOT stop a database superuser, who can drop the trigger —
-- but neither would a role grant, since the same superuser can grant themselves
-- whatever they like. Protecting against that is a matter of who holds database
-- credentials, not of schema.

CREATE OR REPLACE FUNCTION audit_event_is_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'AuditEvent is append-only; % is not permitted on this table', TG_OP
    USING HINT = 'Audit entries record what happened. Correct the record they describe, never the entry.';
END;
$$ LANGUAGE plpgsql;

-- BEFORE, not AFTER: the exception has to be raised before the row is touched.
-- Separate triggers for UPDATE and DELETE so the error names which was tried.
DROP TRIGGER IF EXISTS audit_event_no_update ON "AuditEvent";
CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();

DROP TRIGGER IF EXISTS audit_event_no_delete ON "AuditEvent";
CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();

-- TRUNCATE bypasses row-level triggers entirely, which would empty the table
-- without firing either of the above. It needs its own statement-level trigger.
DROP TRIGGER IF EXISTS audit_event_no_truncate ON "AuditEvent";
CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_is_append_only();
