# docs

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
