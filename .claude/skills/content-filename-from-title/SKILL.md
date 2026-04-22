---
name: content-filename-from-title
description: Turns a prose title into a short, single-word, URL-friendly filename for published content (docs, walkthrough parts, blog slugs, guide pages). Use when adding a new entry to a manifest that exposes public filenames (e.g. walkthrough.json parts, docs/*.md for GH Pages), when renaming an existing one, or when a user asks "what should I name this file?"
---

# content-filename-from-title

<task>
Produce a single-word, lowercase, ASCII-only filename (no extension,
no hyphens, no digits) that best represents the content of a titled
page. The filename goes into a config manifest — `walkthrough.json`
part entries, `docs/` frontmatter, or similar — where it becomes the
public URL segment for that page.
</task>

<context>
## Why this skill exists

Public URLs age badly when filenames carry implementation detail
(`walkthrough-part-1.html`), numbering (`part-3-thing.html`), or
cluttering punctuation (`url-%E2%86%94-purl-conversion.html`). A
title-word filename (`anatomy.html`, `parsing.html`, `conversion.html`)
is short, speakable on a call, typeable, and doesn't need to change
when the surrounding ordering does.

Claude must apply the same reasoning every time, or the fleet of
filenames will drift stylistically across contributors and across
sessions. This skill captures the reasoning as a deterministic
procedure so the output is reproducible.

## Where it fits in the repo

- `walkthrough.json` — the `parts[].filename` field is the URL segment
  the page is published under at `socketdev.github.io/socket-packageurl-js/<filename>.html`.
- `docs/*.md` — the file stem becomes the URL segment when docs are
  stitched into the GH Pages flow (see `docs/pages-design-system.md`
  for the surrounding design system).
- Any future blog or guide manifest added to this repo.

A build-time validator in `scripts/walkthrough.mts` enforces the
**shape** (`[a-z]+`) and **uniqueness**; this skill decides the
**choice** (which word).
</context>

<constraints>
## Hard constraints (validator-enforced)

- **ASCII lowercase letters only:** matches `^[a-z]+$`.
  - No digits (`part2` — FORBIDDEN)
  - No hyphens (`url-conversion` — FORBIDDEN)
  - No underscores, dots, slashes, or unicode
- **Unique across all entries in the manifest.** If the word you picked
  is already taken, pick another that's still content-bearing.
- **Single word.** Compound phrases (`buildingandstringifying`) are
  FORBIDDEN — pick the stronger of the two nouns instead.

## Soft constraints (style)

- **Typeable.** A user on a call should be able to say "go to the
  `anatomy` page" and the listener can type it correctly without
  spelling.
- **Stable.** The word should still make sense if the surrounding
  ordering changes. `part-one` is unstable (it renames when content
  is reordered); `anatomy` is stable.
- **Content-bearing, not generic.** `page`, `doc`, `content`, `item`
  are FORBIDDEN. Pick a word that would still be meaningful if you
  only saw it in a URL with no context.
</constraints>

<instructions>
## Decision procedure

Apply these rules in order. Stop at the first rule that produces a
clean single word.

### Step 1 — Inventory the nouns in the title

Write out every noun and nominalized action (gerund, `-ion`, `-ance`).
Discard every filler word (articles, prepositions, conjunctions, "of",
"and", "&"). Discard every word that appears in 2+ other titles of the
same manifest (those are qualifiers, not distinguishers).

> **Why:** a filename needs to distinguish this page from its
> siblings. A word that isn't unique within the set can never be
> load-bearing.

### Step 2 — Among remaining candidates, pick the distinguishing noun

If one noun is unique to this title and the others are not, that noun
wins.

> **Example:** `"URL ↔ PURL Conversion"` has three nouns (`URL`,
> `PURL`, `Conversion`). `URL` and `PURL` appear in multiple titles;
> `Conversion` is unique to this one. → `conversion`.

### Step 3 — If several nouns are candidates, pick the superset

If the title lists multiple concepts that are facets of one bigger
concept, pick the bigger one.

> **Example:** `"Validation, Errors & Results"` — errors and
> `Result<T,E>` are outputs of validation. → `validation`.

### Step 4 — If the title is "verb on a subject", pick the verb's nominal form

Gerund (`-ing`) if the activity itself is the topic; `-ion` / `-ance`
if the state or result is the topic.

> **Example:** `"Parsing & Normalization"` — normalization is a
> substep of parsing. The activity is the topic. → `parsing`.

### Step 5 — If the title is a plain subject noun, use it directly

If the title is already a single content noun (`Ecosystems`), that's
the filename. Just lowercase it.

### Step 6 — Check hard constraints, then pick an alternative if needed

Now validate the chosen word against the hard constraints:

1. Does it match `^[a-z]+$`? If not, reshape: `URL ↔ PURL` → consider
   nominals like `conversion`, not `urltopurl`.
2. Is it unique across the manifest? If not, go back to Step 2 and
   pick the next-best candidate.
3. Is it content-bearing? If it's generic (`items`, `details`), go
   back to Step 3 — you probably picked too abstract a word.

### Step 7 — Sanity check

Read your picks as a list. Does it feel like a coherent table of
contents? If one word feels off-tempo (too long, too clinical, too
cute), adjust. Internal consistency matters — don't mix
`gerunds` + `nouns` + `adjectives`.
</instructions>

<examples>
## Worked examples — the 8 walkthrough parts

These are the filenames currently in `walkthrough.json` at the time
this skill was written. Each shows the rule that produced the choice.

<example id="1">
<title>Anatomy of a PURL</title>
<filename>anatomy</filename>
<reasoning>
Nouns: `Anatomy`, `PURL`. `PURL` appears in 3 other titles (parts 2, 5),
so it's a qualifier, not a distinguisher. `Anatomy` is unique. → `anatomy`.
Rule applied: Step 2 (distinguishing noun).
</reasoning>
</example>

<example id="2">
<title>Building & Stringifying PURLs</title>
<filename>building</filename>
<reasoning>
Nouns / gerunds: `Building`, `Stringifying`, `PURLs`. `PURLs` is a
qualifier. Stringifying is a substep of building (serialize is the
last step of building). → `building`.
Rule applied: Step 3 (superset) + Step 4 (gerund).
</reasoning>
</example>

<example id="3">
<title>Parsing & Normalization</title>
<filename>parsing</filename>
<reasoning>
Nouns: `Parsing`, `Normalization`. Normalization is a substep of
parsing. The activity is the topic. → `parsing`.
Rule applied: Step 4 (gerund form).
</reasoning>
</example>

<example id="4">
<title>Validation, Errors & Results</title>
<filename>validation</filename>
<reasoning>
Nouns: `Validation`, `Errors`, `Results`. Errors and Result<T,E> are
the outputs/facets of validation. → `validation`.
Rule applied: Step 3 (superset).
</reasoning>
</example>

<example id="5">
<title>URL ↔ PURL Conversion</title>
<filename>conversion</filename>
<reasoning>
Nouns: `URL`, `PURL`, `Conversion`. `URL` and `PURL` are the domain
(appears in multiple titles). `Conversion` is unique.
→ `conversion`. Rule applied: Step 2 (distinguishing noun).
</reasoning>
</example>

<example id="6">
<title>Ecosystems</title>
<filename>ecosystems</filename>
<reasoning>
Title is already a single content noun. Lowercase it.
Rule applied: Step 5 (plain subject noun).
</reasoning>
</example>

<example id="7">
<title>Comparison, Matching & Existence</title>
<filename>comparison</filename>
<reasoning>
Nouns: `Comparison`, `Matching`, `Existence`. Matching is a flavor of
comparison (wildcard comparison). Existence is adjacent but weaker.
→ `comparison`. Rule applied: Step 3 (superset).
</reasoning>
</example>

<example id="8">
<title>Security Primitives & VERS</title>
<filename>security</filename>
<reasoning>
Nouns: `Security`, `Primitives`, `VERS`. In this curriculum VERS is
scoped under security (injection + freeze + VERS-as-safety-boundary).
→ `security`. Rule applied: Step 3 (superset).
</reasoning>
</example>

## Counter-examples — choices the procedure rejects

<example id="bad-1">
<title>Anatomy of a PURL</title>
<rejected>purl</rejected>
<reasoning>
`PURL` appears in multiple titles → fails Step 1 (not
distinguishing). Also fails uniqueness against any other part that
might want `purl`.
</reasoning>
</example>

<example id="bad-2">
<title>Building & Stringifying PURLs</title>
<rejected>buildingandstringifying</rejected>
<reasoning>
Compound phrase — violates the "single word" hard constraint. The
procedure always picks one over merging.
</reasoning>
</example>

<example id="bad-3">
<title>URL ↔ PURL Conversion</title>
<rejected>url-to-purl</rejected>
<reasoning>
Contains a hyphen → fails the `[a-z]+` hard constraint. The validator
would reject this at build time; the skill catches it earlier at
Step 6.
</reasoning>
</example>

<example id="bad-4">
<title>Ecosystems</title>
<rejected>page6</rejected>
<reasoning>
Numeric, generic, unstable to reordering, not content-bearing. Fails
hard constraints (digits) and soft constraints (stability,
content-bearing).
</reasoning>
</example>
</examples>

<checklist>
## Checklist before committing a filename

Copy this into your working notes when adding/renaming a manifest
entry:

```
Filename choice: _______________

- [ ] Matches ^[a-z]+$ (lowercase ASCII letters only)
- [ ] Unique across every other entry in the manifest
- [ ] Content-bearing (not 'page', 'item', 'content', etc.)
- [ ] Stable under reordering (no 'part1', 'first', etc.)
- [ ] Typeable from hearing it spoken
- [ ] Feels consistent with neighbor filenames' style (all gerunds?
      all plain nouns? all -ion forms? one style across the set)
```

If any checkbox fails, return to the decision procedure and pick
again.
</checklist>

<when-not-to-use>
## When NOT to use this skill

- The filename is **internal** (e.g. a build artifact under `dist/`,
  an intermediate JSON in `.cache/`). Internal paths don't need to be
  pretty — use whatever the code naturally emits.
- The filename is **code-shaped**, not content-shaped. TypeScript
  source files follow the convention of the ecosystem (kebab-case,
  matching export names). This skill is for *content* filenames only.
- The manifest exposes a **hash** or **date-based identifier** (e.g.
  a release slug, a git-sha-addressable blob). Use the hash; it's
  already optimal.
</when-not-to-use>

<further-reading>
- `CLAUDE.md` § ERROR MESSAGES — the error-shape the filename
  validator uses when it rejects a bad filename.
- `docs/pages-design-system.md` — the surrounding design system for
  pages that use these filenames.
- `scripts/walkthrough.mts` → `validatePartFilenames()` — the
  validator implementation that enforces the hard constraints.
- `walkthrough.json` — the current live manifest applying this skill.
</further-reading>
