# api/lib

Shared building blocks. Nothing in here knows about a specific module.

## What is here at step 1

| File | Provenance |
|---|---|
| `password.js` | Copied from SiteSilo, unchanged. |
| `storage/index.js`, `storage/local.js` | Copied from SiteSilo, unchanged. |
| `session.js` | Copied from SiteSilo with two changes, both commented in the file: session lifetime is hours from the environment rather than a fixed 7 days, and `prisma` is passed in rather than imported. |
| `upload.js` | Copied from SiteSilo, unchanged. Copied as bytes, never retyped — see below. |

### upload.js

Copy it from SiteSilo verbatim:

```bash
cp "../../building Custom CMS/SiteSilo/api/lib/upload.js" ./upload.js
```

It is not reproduced here on purpose. The file contains byte-signature tables
and regular expressions where a single transcription error would be silent and
security-relevant — it is the code that refuses a file whose contents do not
match its declared type, including the two `image-size` cases that hang the
process rather than throwing. Copy the bytes; do not retype them.

Nothing imports it yet, so step 1's checks pass either way.

## What is deliberately absent

**There is no `prisma.js`.** SiteSilo has one, and it is the one `lib/` file
that does not come across. This system has one database per hospital, so a
module-level singleton is exactly the wrong shape — a request's Prisma client
belongs to the request.

Step 2 adds `tenancy.js` and `control-plane.js` in its place.

## The rule

**No module ever imports a Prisma client. Every module reads `req.prisma`.**

This is what replaces "remember the tenant filter" in a shared-database design,
and it is strictly better: forgetting it produces `undefined` and a stack trace
on the first request, rather than silently serving one hospital another
hospital's patients.
