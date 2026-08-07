# Release

How a new version of `@socketregistry/packageurl-js` gets cut and
shipped to npm with provenance. Releases run through the fleet's
staged release/publish pipeline (cascade-owned scripts under
`scripts/fleet/`); the file headers of those scripts are the
canonical, detailed documentation - this page is the short map.

You do not run `npm publish` directly: the `prepublishOnly` hook in
`package.json` fails on purpose ("Use GitHub Actions workflow for
publishing").

## The flow

### 1. Readiness + version bump (local)

```bash
node scripts/fleet/release-pipeline.mts
```

Runs the readiness chain (preflight, coverage, exports, pack
contents, CI) and hard-stops for you to name the version; resume
with `--version X.Y.Z`. Its bump stage runs
`scripts/fleet/bump.mts`, which derives the next version and the
CHANGELOG section from the Conventional Commits since the last
release tag and creates the bump commit. It does **not** tag -
the tag comes last, after the publish is live. Land the bump on
main like any other change.

### 2. Stage the publish (CI, via dispatch)

```bash
pnpm run npm:publish
```

This runs `scripts/fleet/publish-pipeline.mts`, which dispatches
and watches `.github/workflows/npm-publish.yml`. The workflow
stages the package under npm OIDC trusted publishing (no
long-lived npm token) with a provenance attestation. Nothing is
public yet, and no git tag or GitHub release exists yet.

### 3. Approve + release (local)

```bash
node scripts/fleet/publish-pipeline.mts --approve
```

Promotes the staged version (browser web-OTP 2FA) and, once the
publish is confirmed live on the registry, cuts the git tag and
the immutable GitHub release **last**.

## Useful flags

Both pipelines accept `--dry-run`, `--status`, and `--reset`. The
publish pipeline also takes `--tag <dist-tag>` for non-`latest`
dist-tags, and

```bash
node scripts/fleet/publish-pipeline.mts --reconcile X.Y.Z
```

heals a version that is already live on npm but missing its `v*`
tag + GitHub release (`.github/workflows/release-reconcile.yml`
runs this on a cron).

## Workflows involved

- `.github/workflows/npm-publish.yml` - manual dispatch; staging
  only, dry-run unless `publish: true`.
- `.github/workflows/github-release.yml` - refuses to cut a
  release for a version that is not resolvable on the registry.
- `.github/workflows/release-reconcile.yml` - cron tag-gap
  healing via `--reconcile`.

## Further reading

- [`scripts/fleet/release-pipeline.mts`](../scripts/fleet/release-pipeline.mts)
  and [`scripts/fleet/publish-pipeline.mts`](../scripts/fleet/publish-pipeline.mts)
  - stage-by-stage detail in the file headers.
- [`scripts/fleet/bump.mts`](../scripts/fleet/bump.mts) -
  version-bumping and CHANGELOG-derivation logic.
- [`docs/contributing.md`](./contributing.md) - the pre-PR
  workflow that must land cleanly before any release is possible.
- [npm docs: provenance](https://docs.npmjs.com/generating-provenance-statements)
  - upstream documentation on the attestation format.
