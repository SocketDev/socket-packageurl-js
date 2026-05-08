# Rolldown migration plan

> **Status:** plan only. No migration in progress.
>
> **Decision gate:** complete this plan, validate it with stakeholders, then execute as one atomic PR (no half-state).

This document plans the esbuild → Rolldown migration for
`socket-packageurl-js`. The repo is the most complex single-package
fleet repo on the build-tool axis (487-line `scripts/build.mts` +
352-line `.config/esbuild.config.mjs` with two custom plugins);
validating Rolldown here de-risks the rest of the fleet's library
repos (`socket-lib`, `socket-sdk-js`).

## Why migrate

| Dimension        | esbuild today                                          | Rolldown 1.0                                                                                         |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Bundle perf      | ~1× baseline                                           | ~2× faster on 500+ module projects (Evan You's benchmarks); roughly equal on simple library bundles. |
| Plugin API       | esbuild-specific                                       | Rollup-compatible — opens the entire Rollup plugin ecosystem.                                        |
| Chunking control | Limited (esbuild's known weakness for code-splitting). | Full Rollup-style manualChunks + per-output controls.                                                |
| Tree-shaking     | Aggressive but coarse.                                 | Aggressive AND respects Rollup's pure-annotation conventions.                                        |
| Author           | Single-maintainer (Evan Wallace)                       | VoidZero (Evan You + team), aligned with rest of our toolchain (Vite, Vitest, Oxc).                  |
| Stability        | 7+ years, very stable                                  | 1.0 (May 2026); production-ready per release notes; default in Vite 8.                               |

**Concrete win for socket-packageurl-js:** the path-shortening plugin is straightforward; the lib-stub plugin avoids ~3MB of unreachable code via esbuild's `onLoad` hook. Rolldown's `load()` hook covers the same ground with less ceremony, and Rollup's tree-shaker may cut some of those unreachable paths _without_ a custom plugin (the `@socketsecurity/lib` lazy-load pattern uses `require()` inside conditionals, which esbuild's bundler follows greedily but Rollup may not).

**Concrete risk:** rewrite cost. Both custom plugins must be re-implemented against the Rollup plugin API. Output byte-equivalence is unlikely; we trade equivalent-or-smaller bundles for some shape drift.

## What gets migrated

| File                             | Today                                                | After                                                                                                                     |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `.config/esbuild.config.mjs`     | 352 lines, two custom esbuild plugins.               | `.config/rolldown.config.mts` — Rollup-API plugins (path-shortening, lib-stub).                                           |
| `scripts/build.mts`              | 487 lines, imports `build`/`context` from `esbuild`. | Same shape, imports `rolldown`'s analogous APIs. CLI flag surface unchanged (`--analyze`, `--watch`, `--types`, `--src`). |
| `package.json` `devDependencies` | `esbuild`.                                           | `rolldown` (replaces).                                                                                                    |
| `pnpm-workspace.yaml` `catalog:` | `esbuild: <version>`.                                | `rolldown: <version>` added; `esbuild` entry kept until other fleet repos migrate, then removed fleet-wide.               |

## Migration steps

1. **Audit current esbuild output.** Capture `dist/` byte counts + tree shape; this is the regression baseline. Run `pnpm run build --analyze` and save the JSON metafile.
2. **Add `rolldown` as a `devDependency`.** Pin to 1.0.x. Don't remove esbuild yet — both ship in parallel during validation.
3. **Port `createPathShorteningPlugin`.** Convert the esbuild `setup(build)` shape to Rollup's `name + resolveId/load` plugin shape. The path-rewriting logic is pure regex on `id` strings; the rewrite itself stays the same.
4. **Port `createLibStubPlugin`.** Same conversion. Verify the `@socketsecurity/lib/{globs,sorts}.js` paths still resolve to the absolute paths the regex expects (Rollup may resolve module IDs differently than esbuild).
5. **Write `.config/rolldown.config.mts`.** Mirror the esbuild config: same entries (`src/index.ts`, `src/exists.ts`), same outdir, same external (Node built-ins), same target, same format (CJS).
6. **Add `scripts/build-rolldown.mts`** as a parallel runner. Don't touch `scripts/build.mts` yet. New script imports rolldown + the new plugins. Same CLI flag surface.
7. **Run both builds; diff outputs.** `pnpm run build` (esbuild) and `pnpm run build:rolldown` produce `dist/` artifacts. Compare:
   - Total bytes per file (esbuild vs rolldown).
   - Module count (rolldown should match or beat).
   - Manual smoke tests: `node -e "require('./dist/index.js')"`, `node -e "require('./dist/exists.js')"`.
   - Run `pnpm test` against the rolldown-built `dist/`. All tests must pass.
8. **Decision point.** If rolldown's output is byte-equivalent or smaller AND tests pass: proceed. If output is larger or tests fail: stop, file an issue with the rolldown team, defer.
9. **Cut over.** Rename: `scripts/build.mts` → `scripts/build-esbuild.mts.bak` (one commit on a feature branch); `scripts/build-rolldown.mts` → `scripts/build.mts`; remove `.config/esbuild.config.mjs`; update `package.json` to drop `esbuild`. Single atomic commit so any revert is one operation.
10. **Validate fleet impact.** `npm pack` the result, install it in a fleet repo (`socket-cli`) that consumes `@socketsecurity/packageurl-js`, run `pnpm test`. Tests must still pass with the new bundle.

## Acceptance criteria

- [ ] `pnpm run build` produces a `dist/` byte-equivalent or smaller than esbuild's output.
- [ ] All existing tests pass (`pnpm test`).
- [ ] All snapshot tests pass without snapshot updates (i.e. behavior unchanged).
- [ ] A downstream fleet repo (`socket-cli`) can consume the new bundle and pass its own tests.
- [ ] `pnpm run build --analyze` produces a metafile equivalent or richer than esbuild's.
- [ ] Watch mode (`--watch`) works.
- [ ] Build time is equal or faster than esbuild (measure via `time pnpm run build`).

## Roll-out

If acceptance passes for `socket-packageurl-js`:

1. Apply the same migration to `socket-sdk-js` (similar shape, same lib-stub trick may apply).
2. Apply to `socket-lib` (more complex — the build is monorepo-aware).
3. Migrate the `_shared/scripts/` resolver (per the Vite+ inspiration in
   `socket-repo-template/template/.claude/skills/_shared/skill-authoring.md`)
   so future bundler swaps are one-line changes per fleet.

## Stage 2 (optional, post-rolldown): comptime

Once rolldown lands and stabilizes, evaluate [`comptime`](https://github.com/lukeed/comptime) — a Zig-inspired build-time evaluation plugin from `@lukeed` that exposes `comptime(() => pure())` as an identity helper, then statically replaces the call with the serialized result at build time. Available as both a Vite and Rolldown plugin.

**Why it could fit:** `socket-packageurl-js` ships static data tables (PURL ecosystem definitions, parser rule sets) computed at module load. Replacing those with comptime calls would inline the result into the bundle — smaller runtime cost, smaller bundle (no parsing logic shipped for data that's known at build).

**Why defer:** comptime is at v0.1.0 — early. Per the fleet's adoption rule (stable 1.0+), it doesn't meet the bar yet. The rolldown migration is independent and shouldn't be blocked on comptime maturity.

**When to revisit:** when comptime hits 1.0 or when we have a concrete bundle-size finding that comptime would address. Until then, capture the idea here so it doesn't get lost.

## Roll-back

If acceptance fails: drop the migration commits, file findings with the rolldown team, defer until the next stable release. The fleet stays on esbuild.

## References

- [Rolldown 1.0.0 release notes](https://github.com/rolldown/rolldown/releases/tag/v1.0.0)
- [Rolldown introduction docs](https://rolldown.rs/guide/introduction)
- [VoidZero — announcing rolldown](https://voidzero.dev/posts/announcing-rolldown)
- esbuild config (current): [`.config/esbuild.config.mjs`](../.config/esbuild.config.mjs)
- Build runner (current): [`scripts/build.mts`](../scripts/build.mts)
- Fleet build-tool decision: [`socket-repo-template/template/.claude/skills/_shared/skill-authoring.md`](https://github.com/SocketDev/socket-repo-template/blob/main/template/.claude/skills/_shared/skill-authoring.md)
