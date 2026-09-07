# Running the verification commands on Windows

Development happens on Windows; the server is Linux. Almost every command in
these guides and in the wider world is written for a Unix shell, and four of
the differences bite hard enough to cost an evening. Each one below has been
hit for real on this project.

---

## 1. Single quotes are not quotes in `cmd.exe`

This is the big one. In bash, `'...'` groups text into one argument. In
`cmd.exe` a single quote is an ordinary character, passed along as part of the
argument, and **double quotes** do the grouping instead.

So this Unix command:

```bash
psql -d hms_clinic -c 'SELECT "lastSeenAt", "expiresAt" FROM "Session";'
```

reaches psql as several arguments, and because `"lastSeenAt",` is the first
*properly* quoted one, psql reads it as the **user name**:

```
psql: warning: extra command-line argument "expiresAt" ignored
psql: warning: extra command-line argument "FROM" ignored
Password for user lastSeenAt,:
```

A password prompt, for a user that does not exist, from a command that looks
correct. Nothing in that output says "quoting".

**The conversion:** outer double quotes, and `\"` wherever a double quote has
to survive into the program.

```
psql -U postgres -d hms_clinic -c "SELECT \"lastSeenAt\", \"expiresAt\" FROM \"Session\";"
```

Single quotes *inside* the double-quoted string are fine — they are passed
straight through, which is exactly what SQL string literals need:

```
psql -U postgres -d hms_clinic -c "UPDATE \"Session\" SET \"lastSeenAt\" = now() - interval '3 hours';"
```

The same conversion applies to curl request bodies:

```bash
# Unix
curl -X POST http://clinic.localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"secret"}'
```

```
:: Windows cmd
curl -X POST http://clinic.localhost:3000/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"you@example.com\",\"password\":\"secret\"}"
```

Note `^` rather than `\` to continue a line, too.

**PowerShell is not the escape hatch.** It has its own rules for passing
arguments to native programs, and it strips quotes on the way through in ways
that are harder to predict than cmd's. Use `cmd.exe` for these, or Git Bash if
you would rather use the Unix forms unchanged.

---

## 2. `psql` connects as your Windows user unless told otherwise

`psql -d hms_clinic` connects as `hp` — your Windows account name — not as
`postgres`. That role does not exist in Postgres, so you get a password prompt
that can never succeed.

Always pass the role:

```
psql -U postgres -d hms_clinic -c "..."
```

The password is the one in `api/.env`. To avoid typing it every time, create
`%APPDATA%\postgresql\pgpass.conf` containing one line:

```
localhost:5432:*:postgres:YOUR_PASSWORD
```

This is the Windows equivalent of the `.pgpass` + `chmod 600` step in the CMS
deployment guide. On Windows the file permissions are not checked, but keep the
file out of the repository regardless.

---

## 3. `VAR=value command` does not set an environment variable

In bash, `DATABASE_URL=... npx prisma migrate deploy` runs one command with one
extra variable. `cmd.exe` has no such form — it treats `DATABASE_URL=...` as
the name of a program to run.

**This is why `api/scripts/` contains `.mjs` files rather than npm one-liners.**
Every script that needs to point Prisma at a specific database spawns the CLI
with an environment it builds itself, so the same command works on Windows and
on the server. It is not indirection for its own sake; it is the only portable
way to do it.

---

## 4. Line endings in shell scripts

A `.sh` file saved with Windows line endings fails on the server with:

```
bad interpreter: /usr/bin/env bash^M
```

which names the interpreter, not the real problem. `.gitattributes` forces
`*.sh` to Linux line endings so this cannot happen — but if you ever see that
error anywhere else, now you know what it means.

`scripts/deploy.sh` also needs `chmod +x` once on the server, because Windows
has no executable bit for git to record.
