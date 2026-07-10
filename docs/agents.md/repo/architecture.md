# socket-packageurl-js architecture

Detail extracted from `CLAUDE.md` to keep the in-context file under the 40 KB cap.

TypeScript implementation of the [Package URL spec](https://github.com/package-url/purl-spec) (ECMA-427), compiled to CommonJS.

## Layout

- `src/package-url.ts` — main exports and API
- `src/purl-types/` — type-specific handlers (npm, pypi, maven, etc.)
- `src/error.js` — `PurlError`
- `dist/` — CommonJS build output

## Commands

- Build: `pnpm run build` (`pnpm run build --watch` for dev)
- Test: `pnpm test` (single file: `pnpm test:unit path/to/file.test.mts`)
- Type check: `pnpm run type` ; Lint: `pnpm run lint` ; Check all: `pnpm run check` ; Fix: `pnpm run fix`
- Coverage: `pnpm run cover` (enforces the floors in `.config/repo/cover.json`; `functions` is 100%) ; Update snapshots: `pnpm testu`

## Error patterns

- `PurlError` (parser errors): lowercase start, no trailing period.
  - Component shape: `{type} "{component}" component {violation}`
  - Required component: `"{component}" is a required component`
  - Qualifier: `qualifier "{key}" {violation}`
- Plain `Error` (argument validation): sentence case, trailing period (`'JSON string argument is required.'`).
- Never throw on valid purls. Include `{ cause: e }` when wrapping. No `process.exit()` in library code (OK in `scripts/`).

## Local conventions

- Type imports MUST be separate `import type` statements, never inline `type` in value imports.
- `exactOptionalPropertyTypes` is on: assign conditionally, never `prop = value ?? undefined`.
- Bracket notation with index signatures: `obj['prop']?.['method']`.
- Never `process.chdir()` — pass `{ cwd }` options instead.
- Vitest configs: `.config/vitest.config.mts` (threads, shared) and `.config/vitest.config.isolated.mts` (forks). File suffix `*.isolated.test.mts` for tests that mock globals or use `vi.doMock()`.
