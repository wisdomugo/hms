/**
 * The working task list.
 *
 *   cd docs/_generator && node tasks.cjs
 *
 * Writes TASKS.docx to the repository root, which is gitignored. The document
 * churns on almost every working session; this generator does not, so the list
 * stays reproducible without a binary file making every diff useless.
 *
 * Keep it honest. A task list that records only the pleasant work is a wish.
 */
const { p, rich, bullet, step, code, h1, h2, spacer, callout, table, build } = require('./guide-lib.cjs');

const today = new Date().toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric'
});

build({
  filename: 'TASKS.docx',
  outDir: '../..',
  eyebrow: 'HOSPITAL MANAGEMENT SYSTEM  ·  OUTSTANDING WORK',
  titlePrefix: '',
  title: 'Task list',
  standfirst:
    `Everything outstanding as of ${today}: before the pilot, during it, and ` +
    'in milestone 07. Includes the questions still waiting on an answer and ' +
    'the decisions made without one.',
  docTitle: 'HMS — Outstanding tasks',
  docDescription: 'Hospital Management System — working task list. Regenerate with docs/_generator/tasks.cjs.',
  children: [

    // =====================================================================
    h1('1.  Today, before anything else'),

    h2('1.1  Revoke the GitHub token in GUIDE_22'),
    p('The last page of the CMS deployment guide contains a GitHub personal ' +
      'access token in plain text, beginning github_pat_11AFRNYYQ06. Anyone ' +
      'who reads that document can push to your repositories.'),
    step('GitHub → Settings → Developer settings → Personal access tokens.', 1),
    step('Find that token and revoke it.', 1),
    step('Remove it from the document. Replace it with "paste your token here" ' +
         'so the instruction survives without the credential.', 1),
    step('Generate a fresh one when you next need it, and keep it out of any ' +
         'document you share.', 1),
    callout('A revoked token cannot be un-revoked, and nothing you own breaks ' +
            'by revoking it. The only cost is generating another one.'),

    h2('1.2  Tidy up after the milestone 06 commit'),
    bullet('Delete COMMIT_MSG.txt from the folder above the repository once ' +
           'the commit is pushed.'),

    spacer(),

    // =====================================================================
    h1('2.  Before the pilot hospital sees a real patient'),

    h2('2.1  Choose the region by measuring, not by the map'),
    p('Johannesburg is closer to Lagos than London is, and that does not settle ' +
      'it. African internet traffic frequently routes through Europe, so London ' +
      'can be the faster of the two from a Nigerian connection. It can also go ' +
      'the other way: Google\'s own Equiano subsea cable lands in Lagos and runs ' +
      'to South Africa, which would favour Johannesburg. Neither can be reasoned ' +
      'out from here.'),
    step('Open gcping.com — it pings every Google Cloud region from the browser ' +
         'and ranks them.', 2),
    step('Run it from the HOSPITAL\'S internet connection, not yours. Their ' +
         'staff are the ones who will feel it all day.', 2),
    step('Pick the region that actually measured best.', 2),

    h2('2.2  Provision the machine'),
    table(
      [2600, 6400],
      ['Setting', 'Value, and why'],
      [
        ['Machine type', 'e2-medium — 2 vCPU, 4 GB. Do NOT repeat the 1 GB free-tier shape: the swap-file step in GUIDE_22 Part A exists only because a Vite build gets OOM-killed on 1 GB, and this box runs PostgreSQL as well.'],
        ['Disk', '50 GB balanced persistent disk. You are off the free tier anyway, so there is no reason to accept the slow standard disk.'],
        ['Region', 'Whatever section 2.1 measured. Roughly $27/month in Johannesburg, $31 in London, plus about $5 for the disk.'],
        ['Billing', 'Find the exact $300 credit expiry under Billing → Credits. At ~$32/month the 90 days expire long before the money does, so the comparison you want will come from the monthly bill.'],
        ['Budget alert', 'Set one at $50 so nothing surprises you.'],
        ['Existing CMS', 'Unaffected. Always-free and the trial credit are separate things; adding a paid instance does not cost you the free e2-micro.'],
      ]
    ),

    h2('2.3  Deploy — follow docs/DEPLOYMENT.md'),
    p('The settings on that machine that differ from development, and what each ' +
      'one actually does:'),
    table(
      [2600, 6400],
      ['Setting', 'What it changes'],
      [
        ['NODE_ENV=production', 'More than a label. The X-Tenant header — which lets one localhost act as several hospitals in development — is honoured ONLY when this is not "production". Getting it wrong makes that header a way to switch hospitals.'],
        ['SERVE_STATIC=true', 'Without it the API answers on /api and nothing is served anywhere else, which looks like a broken deployment rather than a missing setting.'],
        ['COOKIE_SECURE=true', 'Session cookies over HTTPS only.'],
        ['DEFAULT_TENANT', 'Leave it UNSET on a shared server. It is a fallback for when no hostname matches, which on a server means serving somebody else\'s hospital to whoever typed the wrong address.'],
        ['HOSPITAL_TZ=Africa/Lagos', 'Where "today" begins. The VM runs on UTC and the hospital does not; without this the day rolls over at 1am and the night shift\'s registrations are filed under tomorrow.'],
      ]
    ),
    bullet('Hostname: an sslip.io address for now, a real domain later. It must ' +
           'match a hostname registered for the hospital in the control plane — ' +
           'a certificate for a hostname the control plane has never heard of ' +
           'gives you a working TLS connection to a 404.'),
    bullet('scripts/deploy.sh carries the executable bit in git now. If the ' +
           'server still refuses it: chmod +x scripts/deploy.sh, once.'),

    h2('2.4  Backups — before the first patient, not after'),
    step('npm run backup', 3),
    step('npm run backup -- --verify. This restores the newest dump into a ' +
         'scratch database and counts the patients in it. Run it, and understand ' +
         'what it printed.', 3),
    step('Add the nightly backup and weekly verify to cron, as DEPLOYMENT.md §7 ' +
         'sets out.', 3),
    step('Set BACKUP_UPLOAD_CMD so a copy leaves the machine.', 3),
    callout('A backup sitting on the disk it protects survives a mistaken DROP ' +
            'TABLE and nothing else. It does not survive the disk failing, the ' +
            'VM being deleted, or the account lapsing — which are the events ' +
            'that actually destroy hospitals\' records. Check the log weekly: a ' +
            'backup cron failing silently for a month is the classic version of ' +
            'this going wrong, and it looks fine until the day it matters.'),

    h2('2.5  Onboard the hospital'),
    step('ASK THE CMD what prefix they want their patient numbers to start ' +
         'with. --prefix is required and there is no default, deliberately: it ' +
         'is printed on every folder label they will ever make.', 4),
    ...code([
      'npm run onboard -- --slug stnicholas \\',
      '                   --name "St Nicholas Hospital" \\',
      '                   --host hms.stnicholas.com.ng \\',
      '                   --prefix SNH'
    ]),
    step('Copy the setup token it prints. Shown once, single-use, scoped to ' +
         'this hospital.', 4),
    step('Open the site, create the first account, sign in.', 4),
    step('Set the hospital\'s status to "piloting" in the control plane. That ' +
         'is what allows reset-tenant.mjs to wipe it; change it to "active" ' +
         'when the pilot ends and the reset command refuses from then on.', 4),

    spacer(),

    // =====================================================================
    h1('3.  During the pilot'),

    h2('3.1  Keep it small, on purpose'),
    p('Real patients, real workflows, two or three named staff. The reason is ' +
      'not caution for its own sake:'),
    callout('ACCESS CONTROL IS NOT BUILT. Every signed-in account can read any ' +
            'patient, merge records irreversibly, and read the audit log. That ' +
            'is acceptable for a CMD and a records officer, who would hold ' +
            'near-total access anyway. It is not acceptable for a whole ' +
            'department. Widen the pilot after milestone 07, not before.'),

    h2('3.2  Collect what they tell you'),
    bullet('What the receptionists find slow, confusing or missing.'),
    bullet('Whether registrations get interrupted and lost — this decides ' +
           'whether the form needs a saved draft (section 5.2).'),
    bullet('How the duplicate suggestions behave against real names. The ' +
           'scoring weights in section 7 are a starting guess, and their ' +
           'records officer is the right person to correct them.'),

    h2('3.3  If the pilot data needs clearing'),
    ...code(['npm run reset -- --slug stnicholas --confirm stnicholas']),
    bullet('Backs up first, refuses on a hospital whose status is "active", ' +
           'drops the database, re-migrates, restores the MRN prefix and issues ' +
           'a fresh setup token.'),
    bullet('Every account goes with it, so somebody has to set the hospital up ' +
           'again.'),
    bullet('The PREFIX survives, but numbering restarts at 00001 — so any ' +
           'folder label printed before the reset now names a different ' +
           'patient. Destroy them.'),

    spacer(),

    // =====================================================================
    h1('4.  Milestone 07 — roles, permissions and user management'),

    h2('4.1  The design that was agreed'),
    bullet('Roles are created by the hospital\'s own super admin (the CMD) and ' +
           'named by them. Permissions are defined in code. Roles cannot be ' +
           'hardcoded, because the staffing model differs from hospital to ' +
           'hospital and a product sold to fifty of them cannot assume one.'),
    bullet('requireOwner() in lib/session.js is a placeholder and is replaced ' +
           'by requirePermission(...). The middleware SHAPE stays exactly as it ' +
           'is, so no call site has to move — only what it consults changes.'),
    bullet('Reading the audit log becomes a permission (audit.read) rather ' +
           'than role === "owner". Very few roles should carry it: the log ' +
           'names who did what.'),

    h2('4.2  Must be built here — currently missing entirely'),
    table(
      [3000, 6000],
      ['Gap', 'Why it cannot wait past milestone 07'],
      [
        ['Password reset', 'Today a CMD who forgets their password has no way back in except wiping the hospital. On a scratch database that is tolerable. Once a real hospital is live the only answer available would be "I can destroy your data, or nothing".'],
        ['CMD sets another user\'s password', 'The same problem one level down, for every member of staff.'],
        ['CMD unlocks a locked account', 'Your decision: keep 5 failed attempts in 10 minutes, but let the CMD release it. Without this a locked-out clerk in a busy clinic waits for the clock.'],
        ['Deactivate a user', 'The session layer already refuses a deactivated account on every request, not just at login — but nothing in the interface can set the flag. Staff leave.'],
      ]
    ),

    h2('4.3  Answer section 6 first'),
    p('Two of those questions change the shape of the permission tables. They ' +
      'are far cheaper to answer before the tables exist than after.'),

    spacer(),

    // =====================================================================
    h1('5.  Module 01 — Patient Registration, remaining work'),

    h2('5.1  The "migrating an existing paper folder" mode'),
    p('Your decision, and the storage for it already exists: PatientIdentifier ' +
      'supports type "legacy-folder", and the registration form already has an ' +
      '"Other numbers" section. What does not exist is the mode itself or the ' +
      'display.'),
    bullet('A distinct registration flow for back-entering existing patients: ' +
           'old folder number first, then the usual fields, marked as a ' +
           'migrated record.'),
    bullet('The old number shown NEXT TO the new MRN on the patient record and ' +
           'in search results — so a clerk holding the paper folder can confirm ' +
           'the record on screen is the right person.'),
    bullet('Searchable by either number.'),
    callout('Not glued onto the MRN itself. A records clerk searching would ' +
            'then have to know which half of a joined number to type, and the ' +
            'MRN check digit stops working the moment the number has a tail on ' +
            'it.'),

    h2('5.2  Possibly: a saved draft on the registration form'),
    p('With a two-hour idle logout, a half-typed registration interrupted by a ' +
      'phone call could be lost. Whether that actually happens is a question ' +
      'for the pilot rather than a reason to build now.'),

    h2('5.3  DEV_GUIDE_06'),
    bullet('Milestone 06 is committed but its guide is not written. Source file ' +
           'goes in docs/_generator/, like 03 to 05.'),

    spacer(),

    // =====================================================================
    h1('6.  Questions waiting on you'),

    h2('6.1  The pilot hospital\'s staffing'),
    p('Their actual job titles, and what each one is allowed to touch. This is ' +
      'a conversation with the CMD, not with me — it is the starting role list ' +
      'for milestone 07, and inventing it would produce exactly the hardcoded ' +
      'assumption the design exists to avoid.'),

    h2('6.2  Do permissions vary by department or ward?'),
    p('Concretely: can a nurse assigned to one ward open the record of a ' +
      'patient on another? Can a doctor in outpatients see an inpatient file?'),
    p('If yes, a permission is not simply "may read patients" — it is scoped, ' +
      'and every role assignment carries a department alongside it. That is a ' +
      'different table shape, and retrofitting it means migrating every role a ' +
      'hospital has already created.'),

    h2('6.3  Who besides the CMD may create accounts?'),
    p('In many hospitals a matron or records manager does the day-to-day adding ' +
      'and removing of staff, and routing all of it through the CMD makes the ' +
      'system annoying enough to be worked around. But that is a governance ' +
      'question, not a technical one.'),

    spacer(),

    // =====================================================================
    h1('7.  Decisions made on your behalf — still open'),

    p('None of these were chosen by you. They are all cheap to change now and ' +
      'progressively less cheap once a hospital has data shaped by them.'),

    table(
      [2600, 3400, 3000],
      ['Decision', 'What was chosen', 'Worth revisiting if'],
      [
        ['Duplicate scoring weights', 'Identifier 100, phone 40, date of birth 30, surname 20, first name 15. Advisory only — it never blocks a registration.', 'The pilot\'s records officer says the suggestions are noisy or miss obvious matches.'],
        ['MRN padding', 'Five digits, 00001 to 99999, resetting yearly.', 'The hospital expects more than 99,999 registrations in a year, or wants continuous numbering across years.'],
        ['Temporary emergency ID', 'TEMP-0043 shape, replaced by a permanent MRN at reconciliation.', 'The hospital already has a convention for unidentified patients.'],
        ['Visit types', 'outpatient, emergency, follow-up, antenatal.', 'Their clinic list differs — this is a plain string and easy to extend.'],
        ['Visit history shown', 'The 20 most recent visits on the patient record.', 'Clinicians want the full history on screen rather than the recent tail.'],
        ['Merge behaviour', 'The losing record is never deleted. It stays, pointing at the survivor.', 'Never, in my view — the paper folder with that number is still on a shelf and somebody will bring it to the window next year.'],
      ]
    ),

    spacer(),

    // =====================================================================
    h1('8.  Known limitations, deliberately deferred'),

    table(
      [3000, 6000],
      ['Limitation', 'When it has to be dealt with'],
      [
        ['HOSPITAL_TZ is one setting per server', 'Correct while every hospital is Nigerian. The moment one is not, it moves into that hospital\'s own Setting table, beside the MRN prefix.'],
        ['npm run fleet does not report migration drift', '/health is unauthenticated and reports no schema information; only /api/health reports applied against expected. Worth surfacing in fleet before there are many hospitals, because one database that missed a migration is a bug report nobody can reproduce.'],
        ['CANARY_FIELDS is a tripwire, not a validator', 'lib/tenancy.js needs a new entry whenever a migration adds a field to User or Session. One field per model is enough — a client that missed one regeneration missed all of it.'],
        ['Patient portal', 'A separate SPA sharing the same API, after the staff app is doing real work.'],
      ]
    ),

    spacer(),

    // =====================================================================
    h1('9.  Recurring traps'),

    p('Each of these has cost time at least once already.'),

    h2('9.1  Prisma version drift in allowScripts'),
    p('api/package.json pins an exact Prisma version. Every Prisma upgrade needs ' +
      'that block updated, or npm silently skips the install scripts and Prisma ' +
      'fails at RUNTIME rather than at install — which is much harder to connect ' +
      'back to the upgrade.'),

    h2('9.2  After any schema change'),
    step('npm run generate', 5),
    step('npm run migrate:all', 5),
    step('FULLY stop and start the API. node --watch does not reliably reload ' +
         'the generated client, and a running process keeps the client it loaded ' +
         'at startup: disk correct, database correct, 500 on login.', 5),

    h2('9.3  Never git pull and restart by hand on the server'),
    p('Use scripts/deploy.sh. Skipping npm run generate gives a stale client and ' +
      'a database that is perfectly fine — an error three frames deep in a ' +
      'service that names nothing useful.'),

    h2('9.4  Windows shells'),
    p('Read docs/WINDOWS.md before running any command copied from a Unix ' +
      'source. Single quotes are not quotes in cmd.exe; psql connects as your ' +
      'Windows user unless told otherwise; VAR=value command does not exist; ' +
      'and multi-line text belongs in a file passed with -F, never in -m.'),

    spacer(),
    rich(['Regenerate this document: ', ['cd docs/_generator && node tasks.cjs']])
  ]
}).catch(err => {
  console.error(err);
  process.exit(1);
});
