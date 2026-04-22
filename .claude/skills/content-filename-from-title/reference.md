# content-filename-from-title Reference

Extended reference material for the `content-filename-from-title`
skill. SKILL.md carries the decision procedure + the 8 worked
examples from the live tour manifest; this file carries the edge
cases, the alternative-manifest-type guidance, and the decision
history that explains why the procedure looks the way it does.

## Table of Contents

1. [When the procedure in SKILL.md does not produce a clean word](#edge-cases)
2. [Manifest types beyond tour.json](#manifest-types)
3. [Handling acronyms, proper nouns, and non-English titles](#special-tokens)
4. [Decision history for the 8 current filenames](#decision-history)
5. [Rejected candidates and why](#rejected-candidates)
6. [Regex + validator reference](#regex--validator)
7. [Cross-references](#cross-references)

---

<a id="edge-cases"></a>
## 1. When the procedure in SKILL.md does not produce a clean word

The decision procedure covers the common cases. When it does not, apply these tie-breakers in order.

### Two words feel equally strong

If Steps 2–4 produce two candidates that both read as "the topic" —
pick the one that is:

1. **Shorter.** Fewer keystrokes, fewer chances to mistype.
2. **More common English.** A word the reader has seen before in other contexts.
3. **Closer to the verb form your neighbors use.** If the manifest's other entries are all gerunds, prefer the gerund. If all `-ion` forms, prefer `-ion`. Internal consistency is worth more than individually-optimal word choice.

If still tied — flip a coin or ask the user; the downstream cost of a wrong pick is low because the filename validator only checks shape, not "optimality."

### The title is in a second language

Translate to English first, then apply the procedure. The filename
is a URL segment consumed globally; English is the lowest-common-
denominator, not a cultural preference. If the original-language
word happens to be a better fit *and* passes `^[a-z]+$`, that is
acceptable — but default to English.

### The title is a person's name, a product name, or a brand

Use the most recognizable single-word form of the name:

- "Linus Torvalds" → `linus` (if the name is the topic) or
  `torvalds` (if the surname is more distinguishing in the set).
- "Meander" → `meander`.
- "Package URL" → `purl` **only if** `purl` is not already taken
  elsewhere in the manifest. Otherwise pick the action, e.g.
  `parsing` or `conversion`.

Don't transliterate, strip accents, or otherwise mangle the name.
Either the plain ASCII form works (`rust`, `kubernetes`) or you
need to pick a different word.

### Every candidate noun is generic

If the title is something like "Overview" or "Introduction" and
you're staring at `overview`, `introduction`, `intro`, `summary` —
these are all generic. Escape by picking a word that describes
**the thing you are introducing**, not the act of introduction:

- "Introduction to PURLs" → `purl` (the subject, not the gerund).
- "Overview of the Build Pipeline" → `pipeline`.

If the title truly has no distinguishing noun, the content probably
needs a better title first. Push back on the title author before
inventing a filename.

### The title contains a URL-unsafe character

Unicode, emoji, arrows, operators — all of these have to be
translated to the nearest ASCII equivalent during Step 6:

- `URL ↔ PURL Conversion` → the arrow is visual; ignore it for
  filename purposes. The nouns are `URL`, `PURL`, `Conversion`.
- `C++ Primer` → `++` is not part of a noun; the noun is `C` but
  `c` is too short to be a good filename. Use the surrounding
  context: `cpp`? `primer`? This is an acronym case (below).

### The title has only one noun and it's already taken

Go to the verb:

- "Injection" is already used. Title: "Injection". → `detecting`.
- Go to the object: "Injection of What?" → `characters`,
  `sequences`.
- Last resort: add a one-word modifier: `injection-safety` **is
  forbidden** (hyphen), but `hardening` works (we actually picked
  this one for a safety doc). Pick a synonym that hits the same
  concept.

---

<a id="manifest-types"></a>
## 2. Manifest types beyond tour.json

The skill's primary home is `tour.json` entries, but the rules
generalize. Quick guide per manifest type:

### tour.json parts

What you've seen — `anatomy`, `building`, `parsing`, etc. Internal
consistency matters because there are 8+ of them in a visible list.
Stick with one style family (all gerunds / all `-ion` / all plain
nouns) where possible.

### tour.json docs (topics)

Same rules as parts. Current entries: `architecture`, `builders`,
`converters`, `hardening`, `release`, `tour`, `vers`,
`contributing`. These lean toward plain nouns (no gerunds) because
they are *topics*, not actions. Stay consistent with that style if
you add one.

### docs/*.md without a manifest

If a doc lives under `docs/` and isn't registered in `tour.json`,
its filename still follows the skill's rules. Examples:
`docs/api.md`, `docs/types.md`, `docs/pages-design-system.md`.
Multi-word here (`pages-design-system`) is acceptable **only when**
it names a compound domain that no single word covers. `api` and
`types` are single words; `pages-design-system` is tolerated
because "design system" is a term of art.

### Blog slugs, if one ever exists

Blog posts usually get 2–4 word slugs — different grammar from the
tour. The skill's rules don't apply. Use this skill only for
**content identifiers in a bounded manifest**, not for prose-heavy
URLs.

### CLI subcommand names

Subcommands (`pnpm tour:build`, `pnpm tour:serve`) follow the same
rules — short, lowercase, content-bearing. `:` is the separator
within pnpm; each segment on its own side of the colon should pass
`^[a-z]+$`.

### API route segments

Same rules again. A REST endpoint at `/anatomy/:id` is more
readable than `/walkthrough-part/:id`.

---

<a id="special-tokens"></a>
## 3. Handling acronyms, proper nouns, and non-English titles

### Acronyms

All-lowercase the acronym and use as a single word:

- `URL` → `url`
- `JSON` → `json`
- `SBOM` → `sbom`
- `CSS` → `css`
- `OIDC` → `oidc`

Do **not** expand (`json` not `javascriptobjectnotation`). Do not
CamelCase (`json` not `JSON`, which violates `^[a-z]+$`). Do not
hyphenate (`sbom` not `s-bom`).

If the acronym clashes with another entry, fall back to a noun
that describes what the acronym *is about* — `json` collides? Use
`config` or `manifest` depending on context.

### Proper nouns / product names

Use the most recognizable lowercase form:

- `GitHub` → `github`
- `TypeScript` → `typescript` (or `ts` if space-constrained, but
  `typescript` is preferred)
- `Socket.dev` → `socket`
- `Val Town` → `valtown` (concatenated — space is not legal)

### Non-English source text

Translate to English. If the English form is awkward, pick the
underlying concept noun:

- "こんにちは" → the title is a greeting; use `greeting` or
  `hello`, not transliterate to `konnichiwa`.
- "packageurl-js 入門" → `intro` or the target ("PURL") — `purl` or
  `getting-started`-style (but this skill is for single words, so
  `intro` or `purl`).

---

<a id="decision-history"></a>
## 4. Decision history for the 8 current filenames

Why each of the 8 tour-part filenames was chosen over alternatives.

### Part 1: `anatomy` (title: "Anatomy of a PURL")

Candidates: `anatomy`, `purl`, `structure`, `shape`.

- `purl` — rejected, shared with Parts 2 and 5.
- `structure` — considered; `anatomy` is more distinctive and
  carries the right "take a thing apart to see how it works"
  connotation.
- `shape` — too visual.
- Winner: `anatomy`. Clinical, short, distinctive.

### Part 2: `building` (title: "Building & Stringifying PURLs")

Candidates: `building`, `stringifying`, `construction`, `build`.

- `build` — same root, shorter, but less gerund-consistent with
  Part 3 (`parsing`).
- `stringifying` — rejected. Stringifying is a specific substep
  (the final serialization). Building is the superset.
- `construction` — considered; `building` is shorter + reads as an
  activity rather than an abstract state.
- Winner: `building`. Gerund form matches Part 3's `parsing`.

### Part 3: `parsing` (title: "Parsing & Normalization")

Candidates: `parsing`, `normalization`, `parse`.

- `normalization` — rejected, it's a substep of parsing.
- `parse` — shorter but breaks gerund consistency.
- Winner: `parsing`.

### Part 4: `validation` (title: "Validation, Errors & Results")

Candidates: `validation`, `errors`, `results`, `validate`.

- `errors` — rejected, output of validation.
- `results` — rejected, ambiguous (result pattern or outcomes?).
- `validate` — gerund would be `validating`; `validation` is the
  `-ion` form, used here because the doc treats validation as a
  topic (the shape of errors/results), not an activity. Mixing
  `-ion` forms with gerunds is acceptable when the semantic shift
  is real.
- Winner: `validation`.

### Part 5: `conversion` (title: "URL ↔ PURL Conversion")

Candidates: `conversion`, `url`, `purl`, `converter`.

- `url`, `purl` — rejected, both appear in multiple titles.
- `converter` — the tool name, not the activity. Awkward as a URL
  segment (reads like a product name).
- Winner: `conversion`.

### Part 6: `ecosystems` (title: "Ecosystems")

Candidates: `ecosystems`, `types`, `handlers`.

- `types` — rejected, too generic (collides with `docs/types.md`
  type reference).
- `handlers` — technical, not reader-facing.
- Winner: `ecosystems`. Plain noun, already in the title.

### Part 7: `comparison` (title: "Comparison, Matching & Existence")

Candidates: `comparison`, `matching`, `existence`, `compare`.

- `matching` — considered strongly; matching is adjacent to
  comparison with wildcards. Rejected as narrower than
  `comparison`.
- `existence` — rejected, it's a separate concern (registry
  checks) awkwardly bundled into this part.
- `compare` — shorter but less gerund-stable.
- Winner: `comparison`.

### Part 8: `security` (title: "Security Primitives & VERS")

Candidates: `security`, `primitives`, `vers`, `safety`,
`hardening`.

- `primitives` — rejected, too abstract.
- `vers` — rejected. VERS is covered in `docs/vers.md`; having a
  tour part also use `vers` would be redundant and collision-prone.
- `safety` / `hardening` — considered for the later-added
  `docs/hardening.md` doc. In the context of Part 8 (which is
  broader than injection detection), `security` reads as the
  superset.
- Winner: `security`.

---

<a id="rejected-candidates"></a>
## 5. Rejected candidates and why

A catalog of candidate filenames we considered and rejected. Use
this to save time when picking a filename that someone has already
thought about.

| Rejected | Because |
|---|---|
| `page` | Generic. Not content-bearing. Every page is "a page." |
| `doc` | Generic. Every doc is "a doc." |
| `item` | Generic. |
| `content` | Generic. |
| `index` | Reserved — conflicts with `index.html`. |
| `part` | Too generic; collides with the structure word itself. |
| `part1`, `part2`, … | Contains digit. Fails `^[a-z]+$`. Also unstable. |
| `first`, `second` | Ordinal. Unstable; renames on reorder. |
| `url-to-purl` | Contains hyphen. |
| `buildingandstringifying` | Compound phrase. Forbidden. |
| `howto` | Too generic; "how to do what?" |
| `intro` | Okay as last resort but generic; prefer the subject. |
| `purl` | In tour.json, collides with multiple parts. |
| `errors` | In tour.json, redundant with `validation`. |
| `primitives` | Abstract; always rejected in favor of the concrete noun. |

---

<a id="regex--validator"></a>
## 6. Regex + validator reference

The build-time validator in `scripts/tour.mts` enforces three
constraints. Use these when hand-validating a filename before
running the build.

### Shape: `^[a-z]+$`

ASCII lowercase letters only. **No** digits, hyphens, underscores,
dots, slashes, or unicode.

```regex
^[a-z]+$
```

Quick-check in a terminal:

```bash
echo -n "yourfilename" | grep -qE '^[a-z]+$' && echo OK || echo FAIL
```

### Uniqueness

Each manifest entry's `filename` must be unique **across all
entries in the same manifest**. For `tour.json`, that means
uniqueness across both `parts` and `docs` combined.

Quick-check:

```bash
node -e "
const c = JSON.parse(require('fs').readFileSync('tour.json','utf8'));
const all = [...c.parts.map(p => p.filename), ...c.docs.map(d => d.filename)];
const dupes = all.filter((f, i) => all.indexOf(f) !== i);
if (dupes.length) console.log('DUPES:', dupes);
else console.log('OK — ' + all.length + ' unique filenames');
"
```

### Presence

Every part has a `filename` set. Validator errors if missing.

---

<a id="cross-references"></a>
## 7. Cross-references

- **SKILL.md** (this skill's main file) — the decision procedure
  and 8 worked examples.
- `CLAUDE.md` § ERROR MESSAGES — the shape of errors the validator
  emits when you break a rule.
- `docs/pages-design-system.md` — the surrounding design system for
  pages that use these filenames.
- `docs/tour.md` — the tour pipeline, including how filenames
  become public URLs.
- `scripts/tour.mts` → `validatePartFilenames()` +
  `validateDocFilenames()` — the two validator functions.
- `tour.json` — the live manifest applying this skill.
