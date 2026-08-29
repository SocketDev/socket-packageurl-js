# Phase 2: Identify candidates

Read `dist/index.js` (or the primary entry) and grep for module imports / requires. The static analyzer keeps modules that are statically reachable from any export. Candidates for stubbing are modules whose entire surface area is:

- **Touch-only**: imported but never called via the published API (e.g. `globs` imported by a deprecated helper that's no longer in the entry chain).
- **Dev-only**: present because of a side-effect import that doesn't matter at runtime (e.g. node:fs/promises pulled in by a build-time helper).
- **Conditional-dead**: behind a flag that the published bundle never sets (e.g. `if (DEBUG_MODE)` where DEBUG_MODE is `false` in the build).

How to identify, in priority order:

1. **Heuristic**: `rg "from '@socketsecurity/lib/(globs|sorts|http-request|.*)'" dist/`. Note which lib subpaths show up. Cross-reference against published API surface (`src/index.mts` exports). Anything imported by the bundle that's not transitively reached from `src/index.mts` is a candidate.
2. **Bundle size scan**: `du -bc dist/*.js | sort -rn | head -10`. Identifies the largest bundle outputs. If `dist/index.js` is unexpectedly large, the heaviest unused dep is usually the culprit.
3. **Plugin echo**: temporarily set `verbose: true` (if added) on `createLibStubPlugin` to log every resolved module. The list of resolved paths NOT under your repo's src/ is the candidate set.

For each candidate, record:

- The absolute resolved path or path-pattern (`/.../@socketsecurity/lib/dist/globs.js`).
- The size impact (run `du -b` on the file).
- The reason the runtime can't reach it.
