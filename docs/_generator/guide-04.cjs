const { p, rich, bullet, step, code, h1, h2, spacer, callout, table, build } = require('./guide-lib.cjs');

build({
  number: '04',
  title: 'The Audit Log',
  filename: 'DEV_GUIDE_04 - Milestone - The Audit Log.docx',
  standfirst:
    'A small milestone, built before the module it exists for — because it is the one thing in this system that cannot be added retrospectively.',
  children: [

    table([2400, 6600], ['Field', 'Value'], [
      ['Milestone', '04 of the build sequence'],
      ['Completed', '2 September 2026'],
      ['Repository', 'github.com/wisdomugo/hms, branch main'],
      ['Status', 'Complete. All eight verification checks passing.'],
      ['New files', '4'],
      ['Modified files', '6'],
      ['New migration', 'add_audit'],
      ['Depends on', 'Milestone 03 — authentication end to end'],
      ['Note', 'Written retrospectively, in September, after milestone 05 — see section 8.']
    ]),

    h1('1.  Why this came before Patient Registration'),

    p('The original plan had roles, permissions and the audit log together as one milestone after Module 01. That order was changed deliberately, and the reasoning is worth keeping because it applies again later.'),

    callout('Permissions decide who MAY act. The audit log records who DID. Only one of them can be added later.'),

    p('Permissions introduced in six months work perfectly from that day forward — every request after the change is checked, and nothing is lost by having started late. An audit log introduced in six months has nothing whatsoever to say about the six months before it. "Who registered this patient in March" is not a question that can be answered retrospectively.'),

    p('Patient Registration was going to create real records. Registering it without a log would have meant a permanent hole in the history of every patient entered during development and early testing. So the log went in first, small and on its own, and roles moved to milestone 06.'),

    p('The cost of the reordering was about two hours. The cost of the other order would have been unrecoverable.'),

    h1('2.  The one rule'),

    callout('No patient data in the log. Ever.'),

    p('Record that somebody opened patient 402\'s record. Never record their diagnosis, their phone number, or the old and new values of a field they edited. The meta column is for identifiers and field NAMES — never field values.'),

    p('Two reasons, and the second is the one people miss.'),

    p('An audit log is read by MORE people than the records it describes — administrators, auditors, whoever is investigating an incident. Copying clinical detail into it quietly widens who can see that detail, without anybody deciding to.'),

    p('And an append-only table is by definition one nobody can correct. Anything wrong or sensitive that lands in it stays there, permanently, in a table specifically designed to resist editing.'),

    p('The rule is stated three times in the code — in lib/audit.js, in the schema comment on AuditEvent.meta, and in modules/audit/README.md — because it is the kind of rule that gets broken later by somebody adding a "helpful" bit of context to a meta field.'),

    h1('3.  What is recorded, and what deliberately is not'),

    p('Milestone 03\'s routes contributed eight events: login, failed login, lockout, logout, password change, password change refused, setup completed, setup rejected.'),

    h2('GET /me is not recorded'),

    p('It runs on every page load. A log where 95% of the rows say "somebody checked they were still signed in" is a log nobody reads — which makes it worse than a smaller one, not better. Volume is not thoroughness, and deciding what NOT to record is most of the design work.'),

    h2('Refused actions are recorded'),

    p('Often they matter more than successful ones. A password change refused because the current password was wrong is what a borrowed workstation looks like from the inside. A burst of lockouts is what an attempted break-in looks like. Neither leaves any other trace.'),

    h2('A failed login records the email that was attempted'),

    rich(['That is a STAFF email, not patient data, and it is the entire value of the entry: "somebody is trying this account" is the question a failed-login log exists to answer. Recording the attempt without the account it targeted would produce rows nobody can act on.']),

    h1('4.  Design decisions'),

    table([2200, 6800], ['Decision', 'Reasoning'], [
      ['actorEmail is a snapshot, not a convenience', 'The actor relation is SetNull, and staff change their names and leave. The log has to stay readable years later without depending on a row that has moved on. Same snapshot rule the system uses for clinical and billing records.'],
      ['actorId is nullable', 'Not every event has a signed-in actor. A failed login has none by definition, and neither does a scheduled job.'],
      ['SetNull, never Cascade, on the actor', 'Deleting a user must never delete the record of what they did. Users are deactivated rather than deleted anyway, so this is a second line of defence.'],
      ['entityId is a String', 'Patient ids are integers, Tenant ids are cuids. A log that can only reference one kind of id is a log that stops being written the first time that is inconvenient.'],
      ['Action names live in ACTIONS, never as literals', 'These are what every future query filters on — "show me every merge this month", "who has been looking at this patient". A typo at a call site becomes an event no report ever finds, and nothing fails to reveal it.'],
      ['Four indexes, each for a real question', 'at (the log is read newest-first, always), actorId ("what has this member of staff been doing"), entity+entityId ("what has happened to this patient" — the investigation query), action ("show me every merge").']
    ]),

    h1('5.  A failed audit write does not fail the action'),

    p('Outside a transaction, a failure to write an audit row is logged loudly to the server log and swallowed. The action itself succeeds.'),

    p('That is a deliberate trade rather than an oversight. A hospital where nobody can register a patient because the audit table is full is worse than a hospital with a visible gap in its log — and the gap is at least visible, in the server log, with the action name attached.'),

    rich(['Where losing an event is genuinely unacceptable — a payment, a drug administration, a merge — ', ['record()'], ' takes a transaction handle instead, so the action and its record commit together or not at all. Milestone 05 uses that for merges.']),

    h1('6.  Append-only, and how far that is actually enforced'),

    p('There is no POST on the audit router, no PATCH and no DELETE, and there never will be. Events are written by lib/audit.js from inside the actions being recorded. An endpoint that accepted events would let anything claim anything happened; one that edited them would defeat the whole point.'),

    callout('Today the APPLICATION enforces append-only. Postgres does not.'),

    rich(['Proper enforcement is a database role holding INSERT and SELECT but not UPDATE or DELETE on this table, granted at deploy time. It is written into modules/audit/README.md and into this document rather than left in somebody\'s head, and it should be done BEFORE THE PILOT HOSPITAL GOES LIVE.']),

    p('Until then, anybody with database access can edit the log — which is a smaller set of people than "anybody with an account", but not an empty one.'),

    h1('7.  Reproducing this milestone'),

    step('Apply the migration and regenerate. The second command is not implied by the first.'),
    ...code([
      'cd api',
      'npx prisma migrate dev --name add_audit --schema prisma/schema.prisma',
      'npm run generate'
    ]),

    step('Push it to every registered hospital.'),
    ...code(['npm run migrate:all']),

    step('Restart both applications. An "Audit log" entry appears in the sidebar for the owner.'),

    h1('8.  Verification'),

    table([500, 4400, 4100], ['#', 'Check', 'Expected'], [
      ['1', 'sign out, then sign in', 'Signed out, then Signed in'],
      ['2', 'sign in with a wrong password', 'a failed row, showing the email tried'],
      ['3', 'six wrong passwords', 'a denied auth.login_locked row after the fifth'],
      ['4', 'change password, wrong current', 'a denied row'],
      ['5', 'change password, correct', 'an ok row with otherSessionsEnded'],
      ['6', 'curl localhost:3000/api/health', 'migrations is now 2'],
      ['7', 'reload the page several times', 'NO new rows'],
      ['8', 'curl /api/audit with no cookie', '401']
    ]),

    spacer(),
    p('Check 7 is the one worth understanding rather than merely ticking. Nothing new appearing is the correct result, and it is the design decision from section 3 made visible.'),

    h1('9.  A note on this document'),

    p('This guide was written after milestone 05, not after milestone 04. The milestone was verified at the time and the work moved straight on to Patient Registration, and the guide was simply missed.'),

    p('It is recorded here rather than quietly back-dated because the convention this project follows — a guide per milestone, written once its checks pass — only means anything if the gaps in it are visible too. A series that silently fills its own holes is one nobody can trust to be complete.'),

    p('The practical consequence: milestone 05\'s guide was written while its details were fresh, and this one was reconstructed. Nothing in it is wrong, but it contains less of the incidental detail — the small surprises, the things that took a second attempt — than a guide written the same week would have.'),

    h1('10.  What came next'),

    rich(['Milestone 05 added the patient actions, and ', ['patient.viewed'], ' is the one that matters most. Registering and editing get logged in every hospital system; LOOKING usually does not. Reading a record is how a confidentiality breach actually happens — nobody edits a neighbour\'s file, they open it.']),

    p('Milestone 06 replaces requireOwner on this router with requirePermission(\'audit.read\') — a permission very few roles should carry, since the log names who did what and reading it is itself an act worth controlling.'),

    spacer(),
    p('Milestone 05 — Module 01, Patient Registration.   Milestone 06 — roles, permissions and user management.', { color: '55686B', size: 19 })
  ]
});
