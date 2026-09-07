# docs/_generator

The developer guides are generated, not hand-formatted. This folder is the
generator.

## Why

There will be roughly twenty of these. Formatting each by hand in Word means
twenty documents that drift apart — different heading sizes, different table
styles, a masthead that gains a stray comma somewhere around guide 11. Here the
layout decisions live in one file and every guide inherits them.

It also makes the guides diffable. A change to what a milestone recorded shows
up in `git diff` as a change to a sentence, not as an opaque binary blob.

## Using it

```bash
cd docs/_generator
npm install          # once — docx is the only dependency
node guide-03.cjs    # writes ../DEV_GUIDE_03 - Milestone - ....docx
```

The `.docx` files ARE committed. This folder exists so they can be corrected and
regenerated, not because anyone has to run it to read them.

## The task list

`tasks.cjs` is the odd one out. It writes `TASKS.docx` to the repository root,
and that document is **gitignored**:

```bash
cd docs/_generator
npm run tasks        # writes ../../TASKS.docx
```

The guides are a record and belong in history. The task list is a scratchpad
that changes on almost every working session, and a binary file that churns
makes every diff useless. So the generator is tracked and the document is not
— the list stays reproducible without the noise.

## Writing a new guide

Copy the newest `guide-NN.cjs` and replace its body. Everything comes from
`guide-lib.cjs`:

| Helper | For |
|---|---|
| `p(text)` | a paragraph |
| `rich([...])` | a paragraph mixing prose and `code spans` — pass code as a one-element array |
| `h1` / `h2` | headings |
| `bullet` / `step` | bulleted and numbered lists |
| `code([lines])` | a shaded terminal block |
| `table(widths, header, rows)` | widths must sum to 9000 |
| `callout(text)` | the one visual emphasis this design allows — use it once per guide at most |
| `spacer()` | breathing room between a table and what follows |

`build({ number, title, standfirst, filename, children })` assembles it and
writes to `docs/`. Three optional keys exist for documents that are not
milestone guides, and `tasks.cjs` is the only thing using them: `eyebrow` and
`titlePrefix` replace the "DEVELOPER GUIDE N" / "Milestone:" masthead text, and
`outDir` (relative to this folder) sends the file somewhere other than `docs/`
— `'../..'` is the repository root.

`step(text, instance)` takes an optional second argument. Omit it and every
numbered step in the document shares one running sequence, which is what a
guide wants. Pass a different number per section when a document has several
independent step lists, or the second section's first step comes out numbered
five.

## What a guide is for

Not a description of the code — the code describes itself, and this project puts
its reasoning in comments as a matter of course. A guide records what the code
cannot:

- **Why** a decision went the way it did, including the option that was rejected
- **What went wrong** during the build, with symptom, cause and resolution
- **How to reproduce** the milestone from scratch
- **What was deliberately left out**, and which milestone picks it up

The "what went wrong" sections are the part that earns the effort. A guide
recording only what worked is a description. One that records the stale Prisma
client and the `changeOrigin` flag is something you can hand to someone else.

## Convention

A guide is written **after** its milestone's verification checks pass, never
alongside the code. A milestone that has not been proven has nothing to record.

Guides 01 and 02 predate this folder; their `.docx` files are committed and
their source is not here. From 03 onward each has a `guide-NN.cjs` beside this
file.
