# prose-code-format-nudge

**Type:** PostToolUse hook (NUDGE - informational, never blocks).

## What it does

After an Edit/Write to a human-facing `*.md`, flag known software
identifiers written as BARE words (e.g. rustls, reqwest, rolldown) that
should be code spans. Surfaces a per-name nudge; never blocks (advisory -
the dictionary can't be exhaustive). Scope is prose only: markdown docs,
CHANGELOG, READMEs - NOT source files, whose comments have their own
conventions.

The dictionary + scanner live in `_shared/known-names.mts` (one source of
truth, shared with the `prose` skill). The dictionary is derived from the
repo's own manifests (package.json, the pnpm catalog, external-tools.json,
Cargo.toml) plus a small curated EXTRA_NAMES, minus an AMBIGUOUS_DENYLIST so
short/English-colliding names don't fire on ordinary sentences.

PostToolUse, not Pre, so the edit lands first and the scanner reads on-disk
state. Exits deterministically; fails open.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
