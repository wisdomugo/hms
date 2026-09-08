# Deploying a hospital

From a bare Ubuntu VM to a hospital signing in, and what has to be true before
real patient data goes anywhere near it.

---

## Before you start: the honest readiness position

| | State |
|---|---|
| Backups | Nightly, verified, off-machine — **set up in step 7** |
| TLS | Caddy, automatic certificates — **step 5** |
| Audit log immutability | Enforced by a database trigger, applied by migration |
| Access control | **Not built.** Every account can do everything |
| Password recovery | Owner resets any account from **Staff**; the owner itself is recovered from the server console |
| Error monitoring | Service logs only |

**Access control is the gap that decides your pilot's shape.** Until milestone
07, any account can read any patient, merge records irreversibly, and read the
audit log. That is fine for two or three trusted people — a CMD and a records
officer would hold near-total access anyway. It is not fine for a whole
department.

So: pilot with **real workflows, real data, and a very small number of named
users**. Widen it after milestone 07, not before.

---

## 1. The machine

A VM with a persistent disk. 2 vCPU and 4 GB is comfortable for one hospital;
the database is the part that grows.

```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # must be 22.22.0 or newer
```

Ubuntu 24.04 ships Node 18, which is why the NodeSource line is there. Installing
the distribution's `nodejs` instead gets you a version the API refuses to start
on, and the error arrives at startup rather than at install.

Confirm Postgres is running, not merely installed:

```bash
sudo systemctl status postgresql --no-pager
```

`active` is what you want. `--no-pager` stops it holding the screen waiting for
you to press `q`.

## 2. Databases

**Generate the password first**, so you are not inventing one at a prompt:

```bash
tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; echo
```

Letters and digits only, deliberately. This password ends up inside a
connection URL in `.env`, where `@ # : / ?` each mean something structural and
have to be percent-encoded — a rule that is easy to forget and produces a
connection failure naming the wrong host. Avoiding those characters entirely
costs nothing.

Copy it somewhere you will still have it in five minutes. It cannot be read
back out of the running system.

```bash
sudo -u postgres createuser --pwprompt clinisynx_dbuser
sudo -u postgres createdb --owner=clinisynx_dbuser clinisynx_controldb
```

`sudo -u postgres` runs the command **as the `postgres` operating-system user**,
which is the account PostgreSQL trusts without a password on a fresh install.
Note the lower-case `-u`: that is sudo's flag for an OS user. Lower-case `-u`
and upper-case `-U` (psql's flag for a *database* user) are different things,
and mixing them up is the mistake recorded in the CMS deployment guide.

### Two different kinds of "user"

`clinisynx_dbuser` is a **database** user: it exists inside PostgreSQL and nowhere else.
Separately there is an **operating-system** user, created in section 3, which
owns files and runs the service. They are unrelated things that both get called
"user", and confusing them is how a systemd unit ends up naming an account that
does not exist.

`postgres` is PostgreSQL's superuser: it can drop any database on the machine
and grant itself anything. The API never holds those keys — `clinisynx_dbuser` owns only
what it needs.

Give `clinisynx_dbuser` the `CREATEDB` privilege — `onboard.mjs` creates a database per
hospital, and `reset-tenant.mjs` drops them:

```bash
sudo -u postgres psql -c "ALTER ROLE clinisynx_dbuser CREATEDB;"
```

Check all three landed:

```bash
sudo -u postgres psql -c "\du"      # clinisynx_dbuser should list 'Create DB'
sudo -u postgres psql -l | grep clinisynx   # clinisynx_controldb, owned by clinisynx_dbuser
```

## 3. The code

First, a Linux account for the API to run as:

```bash
sudo adduser --system --group --home /srv/hms --shell /usr/sbin/nologin clinisynx
```

`--system` means no password and no expiry; `--shell /usr/sbin/nologin` means
nobody can sign in as it, ever. **This is the account the API runs as, and it is
not you.** If the API is ever compromised, the attacker becomes an account that
can read `/srv/hms` and reach the database — not one that can `sudo` to root.
Running a public-facing service as your own login account hands an attacker
everything you can do.

Then the code:

```bash
sudo mkdir -p /srv/hms
sudo chown "$USER":clinisynx /srv/hms
git clone https://github.com/wisdomugo/hms.git /srv/hms
cd /srv/hms/api && npm ci --omit=dev --foreground-scripts
cd ../app && npm ci
```

**You own the code; the service only reads it.** That is deliberate: deploys run
as you (`git pull`, `npm ci`, `npm run build`), and a service that cannot rewrite
its own source cannot be made to.

Two directories are exceptions, because the service genuinely writes to them:

```bash
cd /srv/hms
mkdir -p api/uploads
sudo chown -R clinisynx:clinisynx api/uploads
sudo chmod -R g+rX /srv/hms
```

`api/uploads` holds scanned ID cards and referral letters — hospital data, written
by the running API. `g+rX` lets the `clinisynx` group read the code and enter its
directories without being able to change anything.

> **If npm reports that install scripts were skipped**, Prisma's `postinstall`
> did not run and Prisma will fail at *runtime* rather than at install. The
> `allowScripts` block in `api/package.json` handles it; it names an exact
> version, so a Prisma upgrade needs that block updating.

## 4. Configuration

```bash
cd /srv/hms/api
cp .env.example .env
```

The values that differ from development, and why each matters:

```bash
NODE_ENV=production
# More than a label. The X-Tenant header — which lets one localhost act as
# several hospitals in development — is honoured ONLY when this is not
# "production". Getting this wrong makes that header a way to switch hospitals.

SERVE_STATIC=true
# Without it the API answers but no application is served at all: JSON on /api
# and nothing anywhere else, which looks like a broken deployment rather than a
# missing setting.

COOKIE_SECURE=true
# Session cookies over HTTPS only.

CONTROL_PLANE_URL="postgresql://clinisynx_dbuser:PASSWORD@localhost:5432/clinisynx_controldb?schema=public"
DATABASE_URL="postgresql://clinisynx_dbuser:PASSWORD@localhost:5432/clinisynx_controldb?schema=public"

TENANT_POOL_MAX=3
SESSION_IDLE_MINUTES=120
SESSION_MAX_HOURS=24

HOSPITAL_TZ=Africa/Lagos
# Where "today" begins. The VM runs on UTC; the hospital does not. Without this
# a Lagos hospital's day rolls over at 1am and the night shift's registrations
# are filed under tomorrow.

BACKUP_DIR=/srv/hms-backups
BACKUP_KEEP_DAYS=30
BACKUP_UPLOAD_CMD="rclone copy --config $HOME/.rclone.conf"
```

**Leave `DEFAULT_TENANT` unset on a shared server.** It is a fallback for when
no hostname matches, which on a server means "serve somebody else's hospital to
whoever typed the wrong address". It belongs only on a single-hospital install.

URL-encode `@ # : / ?` in the password.

## 5. TLS and the reverse proxy

Caddy, because it gets and renews certificates without being asked.

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
hms.stnicholas.com.ng {
    reverse_proxy localhost:3000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "same-origin"
    }

    encode gzip
}
```

```bash
sudo systemctl reload caddy
```

The hostname here must match one registered for the hospital in the control
plane, because that is what `resolveTenant` matches on. A certificate for a
hostname the control plane has never heard of produces a working TLS connection
to a 404.

## 6. Running it

`/etc/systemd/system/hms-api.service`:

```ini
[Unit]
Description=HMS API
After=network.target postgresql.service

[Service]
Type=simple
User=clinisynx
Group=clinisynx
WorkingDirectory=/srv/hms/api
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now hms-api
journalctl -u hms-api -f
```

`User=clinisynx` is the OS account from section 3, **not** the `clinisynx_dbuser`
database account. The service needs to read `.env`, so:

```bash
sudo chown "$USER":clinisynx /srv/hms/api/.env
sudo chmod 640 /srv/hms/api/.env
```

640 means you can edit it, the service can read it, and nobody else on the
machine can see the database password at all.

`Restart=always` matters more than it looks: an unhandled rejection at 2am
should cost a hospital thirty seconds, not a morning.

## 7. Backups — do this before the first patient

```bash
cd /srv/hms/api
npm run backup
npm run backup -- --verify
```

`--verify` restores the newest dump into a scratch database and counts the
patients in it. **Run it now, and understand what it printed.** A backup nobody
has restored is a hope, not a backup — and the moment you discover a dump is
unusable should not be the moment you need it.

Nightly, in **your own** crontab (`crontab -e`) — backups are an
administrative job, not something the service does:

```
15 1 * * *  cd /srv/hms/api && npm run backup >> /var/log/hms-backup.log 2>&1
15 2 * * 0  cd /srv/hms/api && npm run backup -- --verify >> /var/log/hms-backup.log 2>&1
```

### Getting a copy off the machine

`BACKUP_UPLOAD_CMD` runs after a successful backup with the run's folder as its
argument. Anything works — `rclone`, `aws s3 sync`, `scp` to another box.

**This is not optional.** A backup sitting on the disk it protects survives a
mistaken `DROP TABLE` and nothing else. It does not survive the disk failing,
the VM being deleted, or the provider account lapsing — which are the events
that actually destroy hospitals' records.

Check the log weekly. A backup cron that has been failing silently for a month
is the classic version of this going wrong, and it always looks fine until the
day it matters.

## 8. Onboarding the hospital

```bash
cd /srv/hms/api
npm run onboard -- --slug stnicholas \
                   --name "St Nicholas Hospital" \
                   --host hms.stnicholas.com.ng \
                   --prefix STN
```

`--prefix` is required and there is no default. It is the hospital's own label
for its patient folders, it ends up printed on paper, and it is theirs to
choose — so ask them before you run this. Two to six characters, letters,
digits and hyphens. Changing it later does not renumber the patients already
registered; it leaves a filing room with two numbering schemes in it.

Copy the setup token it prints — it is shown once, it is single-use, and it is
scoped to this hospital.

Then open the site, create the first account, and sign in.

**Set the hospital's status while it is a pilot:**

```sql
UPDATE "Tenant" SET status = 'piloting' WHERE slug = 'stnicholas';
```

`piloting` is what allows `reset-tenant.mjs` to wipe it. Change it to `active`
when the pilot ends, and the reset command will refuse from then on.

## 9. Updating

```bash
cd /srv/hms
chmod +x scripts/deploy.sh     # once, the first time only
./scripts/deploy.sh
```

`deploy.sh` is a plain text file containing the same commands you would type by
hand, in the order they have to happen. `./scripts/deploy.sh` means "run every
line in that file". The `chmod +x` is needed once because the repository is
committed from Windows, which has no concept of an executable file, so the bit
does not survive the journey.

Backs up, pulls, installs, generates, migrates the control plane, migrates every
hospital, builds the application, restarts, and checks `/health`. Any failing
step stops it there with the old code still running.

**Never `git pull` and restart by hand.** Skipping `npm run generate` gives a
stale Prisma client and a database that is perfectly fine — an error three
frames deep in a service that names nothing useful. It has happened once
already; see DEV_GUIDE_03 §8.1.

## 10. Watching the fleet

From your own machine, or any box with the control plane's connection string:

```bash
npm run fleet
```

Reachable, version, uptime and control-plane health per hospital. It warns when
different hospitals are running different versions, which is the condition that
produces bug reports nobody can reproduce.

---

## Resetting a pilot

```bash
npm run reset -- --slug stnicholas --confirm stnicholas
```

Backs up first, refuses if the status is `active`, drops the database, re-runs
every migration, restores the MRN prefix and issues a fresh setup token.

**Two things to know.** Every account goes with it, so somebody has to set the
hospital up again. And MRN numbering restarts at `00001` — so any folder label
printed before the reset now names a different patient, and should be
destroyed. The prefix itself is read out of the hospital's database before the
drop and written back afterwards, so `SNH/2026/00001-x` stays `SNH`; only the
number restarts.

---

## What is enforced, and what is only conventional

**The audit log cannot be edited.** Not by the application, not by a stray
query, not by `TRUNCATE`. Three database triggers refuse `UPDATE`, `DELETE` and
`TRUNCATE` on `AuditEvent`, and they arrive with the migration so every hospital
gets them automatically.

They do not stop a database superuser, who can drop a trigger. Neither would a
role grant, since the same superuser can grant themselves anything. **That is a
question of who holds the `postgres` password, not of schema** — so hold it
narrowly, and give the application its own limited role as configured above.

**Uploaded documents are tenant-scoped and require a session.** Every storage
key begins with the hospital's slug; the handler refuses anything outside the
requesting hospital's prefix and blocks path traversal separately.

**Access control is not enforced at all yet.** Every signed-in account can do
everything. Milestone 07.

---

## If something goes wrong

**The API will not start.** `journalctl -u hms-api -n 50`. Most often
`CONTROL_PLANE_URL` — the API refuses to start without it rather than serving
requests it cannot route.

**"Cannot read properties of undefined".** A stale Prisma client.
`cd api && npm run generate` and restart. `lib/tenancy.js` catches this at
startup and names the fix.

**A hostname returns 404.** It is not registered to any hospital in the control
plane. Check `TenantHostname`.

**A hospital returns 503.** Its status is `onboarding`. Set it to `active` or
`piloting`.

**Somebody is locked out.** If it is a member of staff, the hospital's owner
resets them from the **Staff** screen — a temporary password is shown once, and
they must choose their own the moment they sign in.

If it is the owner, nobody inside the hospital can help, and that is what this
is for:

```bash
cd /srv/hms/api
npm run set-password -- --slug stnicholas --list
npm run set-password -- --slug stnicholas --email cmd@hospital.ng
```

It prints a temporary password once, ends every session that account has open,
and records the reset in that hospital's audit log with no actor — because
nobody signed in to do it. **Read the password to them over the phone.** SMS and
email keep a copy long after the call is over.

Before this existed, the only route back into a locked-out owner account was
`reset-tenant.mjs`, which destroys every patient record on the way. That is not
an answer anybody should have to give a hospital.

**Restoring.** `npm run restore -- --file <dump> --into <newdb>`. It restores
and stops; it deliberately does not point the hospital at what it restored.
Look at the data first, confirm it is the right day, then update the tenant's
`databaseUrl` and restart. The worst moment to be automating things is the
moment you are restoring from backup.
