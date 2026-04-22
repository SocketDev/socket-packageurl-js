# Release

How a new version of `@socketregistry/packageurl-js` gets cut and
shipped to npm with provenance. Read this before running a release
or changing anything under `.github/workflows/provenance.yml`,
`scripts/publish.mts`, or `scripts/bump.mts`.

## Who this is for

Maintainers cutting a release and contributors curious about what
happens after a PR lands on main. You do not run `npm publish`
directly in this repo — the workflow does it on your behalf.

## The shape of a release

Three things happen, in order:

```
 ┌───────────────────────────────────────────────────────────────┐
 │  1. bump version — local or via CI                             │
 │     • pnpm bump <patch|minor|major|prerelease>                 │
 │     • updates package.json + CHANGELOG                         │
 │     • commits the bump                                         │
 └───────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
 ┌───────────────────────────────────────────────────────────────┐
 │  2. trigger the Publish workflow — manual dispatch             │
 │     GitHub → Actions → 📦 Publish → Run workflow               │
 │     Inputs:                                                    │
 │       • dist-tag (latest | next | beta | canary | …)           │
 │       • debug (0 | 1)                                          │
 └───────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
 ┌───────────────────────────────────────────────────────────────┐
 │  3. the workflow (calling the fleet's shared provenance.yml):  │
 │     ci:validate  → pnpm check + build + coverage               │
 │     publish:ci  → npm publish --provenance                     │
 │     Socket.dev  → post-publish malware audit                   │
 │     Sigstore    → attestation published                        │
 └───────────────────────────────────────────────────────────────┘
```

Nothing publishes without passing all checks. The `prepublishOnly`
hook in `package.json` throws on local `npm publish` attempts so
you cannot accidentally ship from a laptop.

## The workflow file

`.github/workflows/provenance.yml` is a thin delegation to the
fleet-shared workflow at
`SocketDev/socket-registry/.github/workflows/provenance.yml`. The
shared workflow does the heavy lifting; this file just wires up
repo-specific inputs:

```yaml
with:
  debug: ${{ inputs.debug }}
  dist-tag: ${{ inputs.dist-tag }}
  package-name: '@socketregistry/packageurl-js'
  publish-script: 'publish:ci'
  setup-script: 'ci:validate'
  use-trusted-publishing: true
secrets:
  SOCKET_API_KEY: ${{ secrets.SOCKET_API_TOKEN }}
```

Key choices:

- **`use-trusted-publishing: true`** — npm recognizes this
  repository as an OIDC-trusted publisher. No long-lived `NPM_TOKEN`
  secret is stored anywhere; the GitHub Actions runner presents an
  OIDC token, npm verifies it, and the publish proceeds. A leaked
  token in the repo history cannot be used to publish.
- **`setup-script: 'ci:validate'`** — runs `pnpm check` in a clean
  env before the publish starts. Publication aborts if any check
  fails.
- **`publish-script: 'publish:ci'`** — the npm script the workflow
  invokes to actually publish. Wraps `npm publish --provenance`.

### The dist-tag input

| Tag        | Use                                             |
| ---------- | ----------------------------------------------- |
| `latest`   | Default. Production release for most consumers. |
| `next`     | Release candidate before cutting `latest`.      |
| `beta`     | Pre-release on a feature branch.                |
| `canary`   | Experimental / daily / short-lived.             |
| `backport` | Patches to older major lines.                   |

npm shows the `latest` tag by default; other tags require
`npm install <pkg>@<tag>`. Picking the wrong tag (e.g. `latest` for
a breaking pre-release) breaks every downstream consumer that did
not pin. Triple-check the dist-tag on the dispatch form.

## Version bump commands

```bash
# Patch release (bug fixes)
pnpm bump patch

# Minor release (backward-compatible features)
pnpm bump minor

# Major release (breaking changes)
pnpm bump major

# Pre-release
pnpm bump prerelease --preid=beta
```

`pnpm bump` runs `scripts/bump.mts`. It:

1. Reads the current version from `package.json`.
2. Computes the next version per semver rules.
3. Updates `package.json`.
4. Updates `CHANGELOG.md` (prepending a section).
5. Commits the change with a message
   `chore(release): v<new-version>`.
6. Does **not** tag — tagging happens as part of the workflow.

You review and push the bump commit like any other change. The
Publish workflow is a manual dispatch after the bump is on main.

## Provenance — what it means on the npm side

Every release ships with a **provenance attestation**: an Sigstore-
signed statement that says "this tarball was built from commit
`<sha>` of `<repo>` by `<workflow>` at `<time>`." Consumers can
verify via:

```bash
npm install @socketregistry/packageurl-js
npm audit signatures
```

or

```bash
# Inspect the attestation on npm
npm view @socketregistry/packageurl-js dist.provenance
```

A release without a valid attestation either (a) was cut before the
fleet adopted provenance, or (b) was published out-of-band and
should be treated with suspicion. The `provenance.yml` path is the
**only** supported release path for new versions.

## The Socket.dev post-publish audit

The shared provenance workflow runs a Socket.dev scan on the
published tarball immediately after `npm publish`. If Socket flags
malware or a critical issue in the published artifact, the workflow
fails loudly — you'll get a notification, and the release row in
GitHub Actions goes red. npm keeps the version (publish is
irrevocable) but the audit trail captures the alert.

This is belt-and-suspenders: Socket checks the dependency closure
pre-publish via `ci:validate`, but the post-publish audit catches
anything that slipped in between "CI passed" and "tarball on
registry" (re-bundle side-effects, mis-configured files, etc.).

## What lands in the published tarball

```
@socketregistry/packageurl-js-<version>.tgz
├── package.json
├── CHANGELOG.md
├── dist/
│   ├── index.js        + index.d.ts
│   ├── package-url.js  + .d.ts
│   ├── … (every compiled module)
│   ├── purl-types/<ecosystem>.js + .d.ts
│   └── (no sourcemaps — we don't ship them)
└── data/npm/
    ├── builtin-names.json
    └── legacy-names.json
```

Controlled by `package.json`'s `files` field:

```json
"files": [
  "dist/**/*",
  "data/**/*.json",
  "CHANGELOG.md"
]
```

Things explicitly NOT shipped:

- `src/` — TypeScript sources.
- `test/` — test files.
- `scripts/`, `.config/`, `.github/`, `.claude/` — tooling.
- `docs/` — rendered as the tour site, not shipped to npm.
- Any sourcemap or tsbuildinfo.

A CI check (`scripts/ci-validate.mts`) asserts the packed tarball
size stays under a sanity threshold so an accidental `dist/`
explosion or a misconfigured `files` field fails loudly.

## Common release scenarios

### Cutting a normal patch release

1. PRs with bug fixes merge to main.
2. `pnpm bump patch` on a branch; commit + PR + merge.
3. In GitHub, dispatch the Publish workflow with `dist-tag: latest`.
4. Wait for green. Verify the new version on npmjs.com.

### Cutting a pre-release for testing

1. `pnpm bump prerelease --preid=beta` on a branch; commit + PR +
   merge to main (or to a release branch, if you're working off one).
2. Dispatch Publish with `dist-tag: beta`.
3. Consumers test with `npm install @socketregistry/packageurl-js@beta`.
4. When satisfied, `pnpm bump <appropriate-level>` to drop the
   pre-release tag and dispatch again with `dist-tag: latest`.

### Patching an older major

1. Checkout the last-known-good commit on the older major
   (`v1.x.x`).
2. `git checkout -b backport-fix-xyz`.
3. Apply the fix, test, PR into a `release/1.x` branch.
4. `pnpm bump patch` on that branch.
5. Dispatch Publish with `dist-tag: backport` (or a specific tag
   like `1.x-latest`) to avoid bumping the `latest` tag.

### Emergency revert

npm does not let you delete a published version after 72 hours. For
emergencies:

1. Publish a patch release that reverts the bad change.
2. Use `npm deprecate @socketregistry/packageurl-js@<bad-version>
"<reason>"` to mark the bad version deprecated (visible in
   installs, but not removed).
3. Announce in the repo's CHANGELOG and any Socket channels.

Do not use `npm unpublish`; it is a last resort and has messy
consequences (integrity mismatches, dependency confusion risks).

## Hazards

- **Dispatching with the wrong `dist-tag`.** Promoting a
  pre-release to `latest` by accident breaks every un-pinned
  consumer. Read the tag twice before clicking Run.
- **Publishing from a non-clean tree.** The workflow runs
  `ci:validate`, but if a bump commit bundles unrelated changes,
  those ship too. Keep bump commits single-purpose.
- **`publish-script` drift.** The workflow calls the npm script
  whose name is in `publish-script` (currently `publish:ci`). If
  `package.json`'s script is ever renamed, update both the
  workflow input and this doc in the same PR — otherwise the
  workflow fails with "script not found."
- **Trusted publisher misconfig.** If the npm-side trusted-publisher
  config for this repo is removed or the workflow file is renamed,
  publishes will fail with a 403. Check npm's trusted publisher
  settings first.
- **OIDC token lifetime.** The workflow's OIDC-to-npm exchange
  happens in a narrow window. If a retry lands outside it, re-
  dispatch rather than trying to edit tokens.

## Checklist before dispatching a release

- [ ] Main is green on CI.
- [ ] Bump commit is on main and builds + tests pass locally.
- [ ] `CHANGELOG.md` describes every user-visible change in the
      bumped version.
- [ ] `dist-tag` chosen is correct for the kind of release
      (latest / next / beta / canary / backport).
- [ ] If this is a breaking major, the migration notes are in the
      CHANGELOG.
- [ ] No uncommitted changes to `package.json`, `pnpm-lock.yaml`,
      or `data/`.

## Further reading

- [`docs/contributing.md`](./contributing.md) — the pre-PR
  workflow that must land cleanly before any release is possible.
- [`docs/hardening.md`](./hardening.md) — the hostile-input
  posture that makes Socket.dev post-publish scans meaningful.
- [`scripts/publish.mts`](../scripts/publish.mts) — the local
  publish script (mainly for CI; `prepublishOnly` blocks local
  runs).
- [`scripts/bump.mts`](../scripts/bump.mts) — version-bumping
  logic.
- [`.github/workflows/provenance.yml`](../.github/workflows/provenance.yml)
  — the wrapper workflow.
- [npm docs: provenance](https://docs.npmjs.com/generating-provenance-statements)
  — upstream documentation on the attestation format.
- [sigstore.dev](https://www.sigstore.dev/) — the signing /
  transparency service.
