# mermaid-github-safe-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

GitHub renders mermaid with floating control clusters INSIDE the
diagram container (copy/expand top-right, a six-button pan/zoom
cluster mid-right), so diagram content near the right edge gets
covered. This took three PR-body render cycles to learn on a sequence
diagram; the shapes are codified in _shared/mermaid-github.mts and
this nudge fires whenever written content carries a mermaid fence
that violates them - naming the exact rewrite and the wheelhouse
fixer. Advisory only: a diagram not destined for GitHub is fine as
written.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
