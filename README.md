# HMS

Hospital Management System. Express + Prisma + PostgreSQL, with a React staff
application. Built module by module; Patient Registration is module 01.

**This repo is at step 1: the scaffold.** It contains no models, no routes and
no clinical code. What it contains is the plumbing, verified, so that when
something breaks in step 2 there is only one new thing to blame.

---

## Layout

| Folder | What it is |
|---|---|
| `api/` | Express + Prisma + PostgreSQL. Currently the app shell and shared `lib/`. |
| `app/` | The staff application. React + Vite. Currently one screen. |
| `shared/` | Styles and code lists (ICD, LOINC) shared across apps. Empty. |
| `docs/` | Module documentation. One document per module. |
| `scripts/` | Repo and fleet tooling. Empty until step 2. |

Two separate npm projects. Install in each; there is nothing to install at the
root. A `web/` folder joins them later for the patient portal.

## Requirements

- **Node 22.22.0 or newer.** Declared in every `package.json` and in `.nvmrc`.
- **PostgreSQL**, running locally or reachable by connection string.

---

## First run

### 1. Install

```bash
cd api && npm install
cd ../app && npm install
```

> **If npm reports that install scripts were skipped, do not ignore it.** npm 12
> blocks dependency install scripts by default. Prisma needs its `postinstall`
> to download the query engine, and without it Prisma fails at *runtime* rather
> than at install time — a confusing place to find the problem. The
> `allowScripts` block in `api/package.json` handles it; if npm still refuses,
> run `npm install --foreground-scripts` in `api/`.

### 2. Create a database

Prisma creates *tables*. The database itself has to exist first, and nothing
here creates it for you.

```bash
psql -U postgres -c "CREATE DATABASE hms_dev;"
```

That is the whole thing — `-c` runs the statement and exits, so there is no
interactive `psql` session to enter or quit. It will prompt for the `postgres`
password you set when PostgreSQL was installed.

**If `psql` is not recognised**, it is installed but not on your PATH, which is
normal on Windows. Call it by its full path instead:

```
"C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE hms_dev;"
```

Adjust the version number to match yours.

**Or use pgAdmin**, which ships with PostgreSQL: right-click
**Databases -> Create -> Database**, name it `hms_dev`, save.

**To check it worked:**

```bash
psql -U postgres -lqt
```

Name it whatever you like — it only has to match the `DATABASE_URL` you set in
the next step.

> One database is enough for now. From step 2 each hospital gets its own, and
> `scripts/onboard.mjs` creates them — so this is the last database you make by
> hand.

### 3. Configure

```bash
cd api
copy .env.example .env      # Windows
```

Fill in `DATABASE_URL`. Everything else has a working development default.

### 4. Generate the Prisma client

```bash
cd api
npx prisma generate
```

There are no models yet, so there is nothing to migrate. Generation succeeding
against an empty schema is the point — it rules the config out before any model
can be blamed.

### 5. Run

Two terminals.

```bash
cd api && npm run dev     # http://localhost:3000
cd app && npm run dev     # http://localhost:5173/app/
```

---

## Step 1 is done when all five pass

| # | Check | Expected |
|---|---|---|
| 1 | `npm run dev` in `api/` | `API listening on http://localhost:3000` |
| 2 | `curl localhost:3000/health` | `{"status":"ok",...}` |
| 3 | `curl localhost:3000/api/nonsense` | a **JSON** 404, not HTML |
| 4 | open `localhost:5173/app/` | the health payload, fetched **through the proxy** |
| 5 | `npx prisma generate` in `api/` | succeeds |

**Check 4 is the one that earns its keep.** If the Vite proxy is not
forwarding `/api`, the dev server answers with `index.html` and a 200 rather
than a 404, and any code calling `.json()` on that throws
`Unexpected token '<'` — which names nothing useful. The step-1 screen checks
the content type specifically, so that failure explains itself. Prove it now,
with nothing else in the system, and it never has to be diagnosed again.

Note the URL has `/app/` on the end. `base: '/app/'` in `vite.config.js`
applies in development too, which leaves the root free for the patient portal
later.

---

## What is deliberately not here

- **No hospital models.** `prisma/schema.prisma` has a generator and a datasource
  and nothing else. The control plane has its own schema, and that one does have
  models — it is a different database.
- **No routers.** `api/index.js` has one marked insertion point instead, for
  milestone 03.
- **No auth screens.** `lib/session.js` and `lib/password.js` are present but
  nothing imports them yet.

## The one rule that shapes everything after this

**No module ever imports a Prisma client. Every module reads `req.prisma`.**

This system runs **one database per hospital**. On a shared server the tenant
middleware resolves a hostname to a hospital and attaches that hospital's client
to the request; on a hospital's own server the control plane holds exactly one
row and resolves to it every time. Same build, either way — the deployment mode
is configuration, not a code fork.

That is why there is no singleton to import. And it is why this is safer than a
shared database with a `tenantId` column: forget the tenant here and you get
`undefined` and a stack trace on the first request, rather than silently serving
one hospital another hospital's patients. **The failure mode of forgetting is a
crash, not a leak.**

`api/lib/session.js` is already written in this shape — it takes `prisma` as an
argument rather than importing one. That was done at milestone 01, so the file
had no dangling import and milestone 02 could be purely additive.

---

## Milestones

| # | What it built | Status |
|---|---|---|
| 01 | Scaffold, shared library, verified plumbing | Complete |
| 02 | The tenant seam — control plane, per-hospital databases, fleet scripts | Complete |
| 03 | Authentication end to end | Next |
| 04 | Roles, permissions, audit log | |
| 05 | `add_patients` — Module 01, Patient Registration | |

Each gets a developer guide in `docs/`, written once its verification checks
pass.

## Working with the tenant seam

There are now two kinds of database. The **control plane** (`hms_control`) holds
the routing table: which hostname belongs to which hospital, and where that
hospital's data lives. A **hospital database** holds one hospital's records.

```bash
cd api

# Add a hospital: creates its database, migrates it, registers it.
npm run onboard -- --slug demo --name "Demo Hospital" --host demo.localhost

# Apply pending migrations to every hospital. Part of every deploy.
npm run migrate:all
npm run migrate:all -- --dry-run

# Change the routing table's own schema (rare).
npm run control:migrate                        # apply existing
npm run control:migrate -- --dev --name x      # create a new one
```

In development, three things can select a hospital, in this order:

1. `X-Tenant: demo` as a request header — ignored when `NODE_ENV=production`
2. the request's hostname
3. `DEFAULT_TENANT` in `.env`, which is also what a single-hospital install uses

Lookups are cached for `TENANT_CACHE_MS`, so a newly onboarded hospital can take
up to a minute for a running API to notice.

## What milestone 03 does

Authentication end to end:

- `User` and `Session` as the first **hospital** migration, `add_auth`
- `modules/auth/` — login, logout, `/me`, `/status`, and the token-gated
  `/setup` that creates the first account on a fresh installation
- the staff app's real shell: the three-state auth probe (checking / ready /
  unreachable) replacing the health screen

`lib/session.js` already takes `prisma` as an argument, so it plugs into
`req.prisma` with no changes. `requireOwner` in that file is a placeholder;
milestone 04 replaces it with `requirePermission` backed by real tables.
