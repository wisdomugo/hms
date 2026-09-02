const { p, rich, bullet, step, code, h1, h2, spacer, callout, table, build } = require('./guide-lib.cjs');

build({
  number: '03',
  title: 'Authentication End to End',
  filename: 'DEV_GUIDE_03 - Milestone - Authentication End to End.docx',
  standfirst:
    'The first milestone where the whole chain runs — hostname to hospital to database to session to user — and the first hospital migration, so migrate:all finally does something visible.',
  children: [

    table([2400, 6600], ['Field', 'Value'], [
      ['Milestone', '03 of the build sequence'],
      ['Completed', '2 September 2026'],
      ['Repository', 'github.com/wisdomugo/hms, branch main'],
      ['Status', 'Complete. All eleven verification checks passing.'],
      ['New files', '8'],
      ['Modified files', '11'],
      ['New migrations', 'add_auth (hospital) · add_setup_token (control plane)'],
      ['Depends on', 'Milestone 02 — the tenant seam']
    ]),

    h1('1.  What this milestone covers'),

    p('Milestone 03 makes the system usable by a person. It adds the first hospital models — User, Session and LoginThrottle — the routes that sign someone in and out, and the staff application\'s real shell in place of milestone 01\'s health screen.'),

    p('It is also the first time every layer built so far runs in sequence for a single request. A browser asks for a page; the hostname resolves to a hospital; that hospital\'s database is opened; a session token in a cookie is looked up in it; the user attached to that session is returned. Each of those was built and verified separately. This is where they meet.'),

    rich(['It is also the first HOSPITAL migration, which means ', ['npm run migrate:all'], ' finally does something visible, and ', ['/api/health'], ' reports a migration count above zero.']),

    h1('2.  Design change: the setup token left the environment'),

    p('Milestone 01 inherited a SETUP_TOKEN environment variable — a secret that authorises creating the first account on a fresh installation. It was correct for a single-tenant CMS and wrong here, and this milestone is where that surfaced.'),

    callout('One token in .env is one token for the whole server.'),

    p('On a shared server that means whoever holds it can claim the first account at any hospital that has not been set up — including one onboarded next month, by someone who left the company last year. The token is not scoped to anything.'),

    p('It is now a column on Tenant in the control plane: generated per hospital by onboard.mjs, printed once, and cleared the moment it is spent. SETUP_TOKEN is commented out of .env and .env.example with the reason, rather than deleted, so anyone who remembers it finds out where it went.'),

    h2('Two details in how it is spent'),

    p('The token is verified BEFORE the account is created and cleared AFTER. Clearing first would burn it if account creation then failed, leaving the hospital unable to set up at all and needing a database edit to recover.'),

    rich(['And ', ['/api/auth/status'], ' reports ', ['setupAvailable'], ' separately from ', ['needsSetup'], '. A hospital with no accounts and no token is stuck, and the application says so rather than offering a form that cannot succeed. That screen was seen for real during testing, and it did its job.']),

    h1('3.  Login throttling moved into the database'),

    p('SiteSilo counted failed logins in an in-memory Map, and its own comment said what that was worth: fine for a single-instance CMS. Two things make it wrong here.'),

    bullet('It resets when the process restarts, so an attacker gets a fresh five attempts after every deploy.'),
    bullet('It lives in one process, so it counts nothing the moment there is more than one.'),

    p('It is now a LoginThrottle table in the hospital\'s own database — which makes it per-hospital for free. Hammering one hospital\'s login cannot lock an account at another that happens to share an email address, and no code had to be written to achieve that. It is a property of putting the table where the data already lives.'),

    h1('4.  Deactivation, not deletion'),

    rich(['User carries an ', ['isActive'], ' flag, and ', ['getSession'], ' checks it on EVERY request rather than only at login. Deactivating someone signs them out on their next call rather than whenever their twelve-hour session happens to expire — which is the actual expectation when a member of staff is removed.']),

    p('Users are never deleted. A deleted user makes years of clinical history say "unknown", and clinical history is the thing this system exists to keep.'),

    p('The session row is deliberately left in place when a deactivated user is rejected. It will expire on its own, and deleting it there would mean a read path performing a write on every request.'),

    h1('5.  What was built'),

    table([2700, 6300], ['File', 'Purpose'], [
      ['modules/auth/routes.js', 'HTTP only. login, logout, /me, /status, /setup, /password. A mixed router: most of it must be reachable without a session, so /me and /password guard individually and each says so.'],
      ['modules/auth/service.js', 'The rules. Takes prisma as its first argument, so another module can call it without an HTTP hop. Milestone 04 wraps these functions with the audit log — one place rather than scattered through routes.'],
      ['modules/auth/README.md', 'The module\'s decisions, and the shape the rest follow.'],
      ['prisma/schema.prisma', 'User, Session, LoginThrottle. The first hospital models.'],
      ['prisma/control/schema.prisma', 'Tenant.setupToken.'],
      ['lib/session.js', 'isActive checked on every request.'],
      ['lib/control-plane.js', 'verifySetupToken, clearSetupToken, hasSetupToken. The token is read here and nowhere else — never placed on req, never returned, never logged.'],
      ['lib/tenancy.js', 'A canary against a stale generated client — see section 8.'],
      ['app/src/auth/AuthContext.jsx', 'The three-state probe: checking, ready, unreachable.'],
      ['app/src/screens/', 'Login, Setup, Home, Account.'],
      ['app/src/App.jsx', 'The real shell — sidebar, routing, and the auth gate.']
    ]),

    h1('6.  The module shape, set here'),

    p('Auth is the first module, so it also settles the layout every later one copies.'),

    table([2200, 6800], ['File', 'Holds'], [
      ['routes.js', 'HTTP concerns only — parsing, status codes, cookies, which routes are public and why.'],
      ['service.js', 'The rules. Takes prisma as its first argument so it is callable from another module directly, and so transactions can span modules.'],
      ['README.md', 'The decisions. Not a description of the code — the reasons that are not visible in it.']
    ]),

    spacer(),
    rich(['Milestone 05 adds ', ['schema.js'], ' (zod) to that list. Auth\'s validation is small enough that inline checks are honest; a patient registration payload is not.']),

    h1('7.  Three states on the front end, not two'),

    p('The application distinguishes "checking", "ready" and "unreachable", and retries three times before giving up.'),

    p('Tracking only signed-in versus signed-out means an API that is down, a database with no tables, and a hostname matching no hospital all render the same login screen — which looks like a working installation rejecting your password. People then try other passwords instead of looking at the server.'),

    p('This was not a theoretical concern. During this milestone the application showed "Can\'t reach the API" while the real fault was a stale Prisma client returning 500 from /api/auth/status. The screen was correct, and its message already pointed at migrations.'),

    p('Each failure branch names something specific to check: a 404 means the hostname matched no hospital, a 503 means the hospital is still marked onboarding, a 503-adjacent 403 means suspended, a 500 means the API is up but something behind it is not, and HTML instead of JSON means the development proxy is not forwarding /api.'),

    h1('8.  Problems encountered, and their resolutions'),

    h2('8.1  A stale generated Prisma client'),
    table([1900, 7100], ['', ''], [
      ['Symptom', 'The API started cleanly, then every request to /api/auth/status failed with: TypeError: Cannot read properties of undefined (reading \'count\'), three frames deep in service.js. The application showed "Can\'t reach the API".'],
      ['Cause', 'prisma.user was undefined. `prisma migrate dev` created and applied the add_auth migration correctly — the tables existed — but did not regenerate the client. generated/prisma/ was still the empty one from milestone 01, dated hours earlier, with an empty models/ folder.'],
      ['Why it was asymmetric', 'The control-plane script runs `prisma generate` itself after migrating. The hospital schema went through raw `npx prisma migrate dev`, which did not. That inconsistency was in the tooling, not in Prisma.'],
      ['Resolution', 'npx prisma generate --schema prisma/schema.prisma'],
      ['Prevented two ways', 'An `npm run generate` script that regenerates BOTH clients in one command; and a canary in lib/tenancy.js that checks the generated client knows about user and session when it builds a tenant client, throwing with the fix in the message rather than letting the failure surface three frames deep.']
    ]),

    spacer(),
    h2('8.2  changeOrigin made hostname resolution untestable'),
    table([1900, 7100], ['', ''], [
      ['Symptom', 'DEFAULT_TENANT=clinic was set, but the application resolved to Development Hospital regardless.'],
      ['Cause', 'Two things compounding. DEFAULT_TENANT is a fallback, not an override — a matching hostname always wins, by design, because a fallback that beat the hostname would silently serve one hospital under another\'s domain. And the Vite proxy had changeOrigin: true, which rewrites the Host header to the proxy target, so the API saw "localhost" for every request no matter what was in the address bar.'],
      ['Why it mattered', 'Together they meant the production resolution path could not be exercised locally at all. Every development request reached whichever hospital happened to own "localhost". A flag copied from a codebase that had no tenancy.'],
      ['Resolution', 'changeOrigin: false, plus allowedHosts: [\'localhost\', \'.localhost\'] so subdomains work. clinic.localhost:5173 now resolves the way it will in production.'],
      ['Also', '.env.example now says plainly that DEFAULT_TENANT is a fallback and not an override, and points at /api/health\'s tenant.via to see which one actually resolved.']
    ]),

    spacer(),
    p('Both faults share a shape worth noticing: each was a setting inherited from a single-tenant codebase that stayed correct-looking after the system stopped being single-tenant. Neither produced an error at the point it was wrong.', { italics: false }),

    h1('9.  Reproducing this milestone'),

    step('Create the hospital migration and regenerate. The second command is not implied by the first — see 8.1.'),
    ...code([
      'cd api',
      'npx prisma migrate dev --name add_auth --schema prisma/schema.prisma',
      'npm run generate'
    ]),

    step('Create the control migration for Tenant.setupToken.'),
    ...code(['npm run control:migrate -- --dev --name add_setup_token']),

    step('Push add_auth to every registered hospital.'),
    ...code(['npm run migrate:all']),

    step('Onboard a hospital that has a setup token. Copy the token it prints — it is shown once.'),
    ...code(['npm run onboard -- --slug clinic --name "Test Clinic" --host clinic.localhost']),

    step('Run both applications and open the hospital by its own hostname.'),
    ...code([
      'cd api && npm run dev',
      'cd app && npm run dev',
      '',
      '# then: http://clinic.localhost:5173/app/'
    ]),

    h1('10.  Verification'),

    table([500, 4400, 4100], ['#', 'Check', 'Expected'], [
      ['1', 'npm run migrate:all', 'every hospital listed, all up to date'],
      ['2', 'curl localhost:3000/api/health', 'migrations is now 1, not 0'],
      ['3', 'open clinic.localhost:5173/app/', 'the setup screen, naming the hospital'],
      ['4', 'submit setup with a wrong token', '"Invalid or already-used setup token"'],
      ['5', 'submit with the right token', 'signed in, landed on Home'],
      ['6', 'reload the page', 'still signed in — the cookie survives'],
      ['7', 'sign out, then sign in', 'works with the chosen password'],
      ['8', 'six wrong passwords', 'the sixth answers "Too many attempts"'],
      ['9', 'Account, change password', 'succeeds, and reports how many other sessions ended'],
      ['10', 'stop the API, reload the app', '"Can\'t reach the API", not a login form'],
      ['11', 'curl -H "X-Tenant: demo" .../api/auth/status', 'needsSetup true, setupAvailable false']
    ]),

    spacer(),
    p('Check 10 is the one that repays the three-state probe, and check 11 shows the stuck state a hospital is in with no accounts and no token — the application says so rather than offering a form that cannot succeed.'),

    h1('11.  What is still placeholder'),

    rich(['role is a string column holding ', ['\'owner\''], ' or ', ['\'staff\''], ', and requireOwner in lib/session.js compares against it. A hospital has receptionists, triage nurses, doctors, lab scientists, pharmacists, cashiers, records officers, HR and a medical director, with permissions varying by department and ward.']),

    p('Milestone 04 replaces both with Role and Permission tables and requirePermission. The middleware SHAPE stays exactly as it is, so no call site has to move — which is the reason it was written in that shape now rather than as an inline check.'),

    p('There is also no user management yet: no way to create a second account, deactivate one, or reset someone\'s password. That belongs with roles, because in a hospital who may create an account is itself a permission.'),

    h1('12.  Known gap, still carried'),

    rich([['/uploads'], ' serves one directory to every hospital — correct for one instance per hospital, a cross-tenant read on a shared server. Nothing writes there yet. Milestone 05 brings patient attachments and must close it.']),

    h1('13.  Next milestone'),

    p('Milestone 04 — roles, permissions and the audit log.'),

    bullet('Role and Permission tables, seeded with the roles the test hospital actually staffs.'),
    bullet('requirePermission(\'patient.register\') replacing requireOwner, with the same middleware shape.'),
    bullet('User management: create, deactivate, reset — each gated by a permission rather than a string comparison.'),
    bullet('An append-only AuditEvent table, and the wrapper in the service layer that writes to it. Login, failed login, logout and password change are the first four events, and they already exist to be recorded.'),

    spacer(),
    p('Milestone 05 — add_patients, and Module 01, Patient Registration.', { color: '55686B', size: 19 })
  ]
});
