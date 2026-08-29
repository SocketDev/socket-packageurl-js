# Phases

### Phase 1: inventory (read-only engine)

Run the three probes + categorization in one read-only pass:

```sh
node .claude/skills/fleet/cleaning-ci/lib/clean-ci.mts --pretty {owner}/{repo}
```

It emits, per repo, `{ orphanFiles, staleRecords, securityFixesEnabled }` plus a
`proposed` action plan as DATA (the orphan files to `git rm`, the workflow-record
ids to delete, whether to toggle off automated-security-fixes). Plain (no
`--pretty`) emits the JSON envelope. The categorization is:

- **orphan-file** (`deleteFile`): an orphan YAML on disk (one of the four canonical names).
- **stale-record** (`deleteRecord`): a workflow record whose `.path` no longer exists OR whose
  name matches the orphan pattern (GitHub-managed `dynamic/` records are
  excluded - they can't be API-deleted).
- **security-toggle** (`toggleOff`): `automated-security-fixes: true`.

The engine performs NOTHING - it only inventories + proposes. It is the FIRST
class of fleet operation that would do irreversible server-side GitHub deletes,
so the deletes stay model-driven: read the `proposed` plan, apply the
legitimate-retired-workflow judgment (a `path-missing` record may be a
deliberately-kept renamed workflow per the carve-outs in
[references/exclusions.md](exclusions.md)), and issue each delete yourself in
Phases 2-4 under the per-repo confirmation gate.

### Phase 2: file deletions (commit + push)

```sh
git rm .github/workflows/{lint,check,type,test}.yml 2>/dev/null
git commit -m "chore(ci): remove orphan {lint,check,type,test} workflows (consolidated into ci.yml)"
```

One commit per repo, conventional-commit subject. Push directly to
main per fleet policy (or fall back to PR if branch protection
requires).

### Phase 3: workflow record deletions (gh api)

For each stale-record finding:

```sh
gh api -X DELETE "repos/{owner}/{name}/actions/workflows/{id}"
```

GitHub returns 204 on success. The record disappears from the
Actions sidebar. Runs associated with the workflow remain in their
own URLs but stop showing in the per-workflow filter.

Skip workflow records that match `dynamic/dependabot/...`. Those are GitHub-managed and can't be deleted via API. They'll stop appearing on their own once Dependabot has nothing to do (after Phase 4).

### Phase 4: disable Dependabot automated-security-fixes

```sh
gh api -X DELETE "repos/{owner}/{name}/automated-security-fixes"
```

204 = disabled. Going forward, security advisories are visible in
the Security tab (via the `vulnerability-alerts` setting, which
stays on) but won't open auto-PRs. The fleet's `/updating-security`
skill is the canonical path for resolving them.

### Phase 5: report

For each repo: list what was deleted, what was disabled, and what needs manual UI action (rare; most things this skill touches are API-actionable).

## Fleet-wide invocation

```sh
# One repo
/cleaning-ci socket-foo

# All fleet repos (reads template/.claude/skills/cascading-fleet/lib/fleet-repos.json)
/cleaning-ci --all
```

The fleet-roster path is the canonical list. Same file the cascade mechanism uses. Don't hard-code a repo list inside this skill.

## Why a skill, not a hook

This is operator-invoked maintenance, not edit-time enforcement. Hooks are the wrong shape: there's no `gh commit` or `gh push` event that should trigger a fleet-wide CI audit. Skills are user-callable, run on demand, and produce a one-shot report.
