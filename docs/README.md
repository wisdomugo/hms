# docs

## Developer guides — one per milestone

A record of what was built at each milestone, why the decisions were made that
way, how to reproduce it from scratch, and what went wrong on the way. Named
`DEV_GUIDE_NN - Milestone - <what it covers>.docx`.

| Guide | Covers | Status |
|---|---|---|
| 01 | Scaffold, shared library and verified plumbing | Complete — 2 Sep 2026 |
| 02 | The tenant seam: control plane, per-hospital databases, fleet scripts | Complete — 2 Sep 2026 |
| 03 | Authentication end to end | Complete — 2 Sep 2026 |
| 04 | Roles, permissions and the audit log | Next |
| 05 | `add_patients` — Module 01, Patient Registration | |

The guides are generated, not hand-formatted — see `_generator/`. From 03
onward each has a source file there, so a guide can be corrected and
regenerated rather than edited in Word.

The "what went wrong" sections are the point. A milestone that records only
what worked is a description; one that records the version drift in
`allowScripts` and the `master`/`main` mismatch is something you can hand to
someone else.

## Module documentation

One document per module, alongside the workflow documents already written in
`Hospital Mgt System2/`.

Two documents belong here as they are produced, and they are different things:

- **The workflow document** — what the hospital does, in their words. Already
  written for modules 01 and 02.
- **The module README** — what was built and why, living in
  `api/modules/<name>/README.md` rather than here. Decisions, not descriptions:
  why a column is nullable, why a delete is refused, what the snapshot holds.

Carried over from SiteSilo's `docs/WORKFLOW.md`, and more important here than
there:

> **Code travels by git. Content does not.**
>
> `migrate dev` on your machine, `migrate deploy` on a server. Never the
> reverse — `migrate dev` offers to drop every table when it detects drift, and
> on a hospital's server that is patient records.

With one database per hospital, add one more:

> **Nobody edits a hospital's database by hand.** Every change is a migration in
> this repo. A database that has been touched directly is one your next
> migration cannot safely run against, and you will not find out until it fails.
