#!/usr/bin/env node
/**
 * @file Whether THIS repo cuts GitHub Releases, read from its own settings.
 *   A GitHub Release is one distribution channel, not the only one. The
 *   wheelhouse ships its fleet pack as an OCI artifact on GHCR — members pull
 *   it anonymously through `ghcr-fetch.mts`, and `pack-reads-are-registry-only`
 *   gates that path — so a parallel set of GitHub Releases carried the same
 *   bytes under a second name nobody fetched from. Deleting them left the
 *   workflow that recreates one on the next `v*` tag.
 *   Not deleted fleet-wide, deliberately. Members that publish to npm or
 *   crates.io use the release as the immutable marker their consumers and
 *   provenance checks read, so removing the workflow from `template/base`
 *   would take a channel those repos depend on. Opting out is per repo, and
 *   defaults to ON so a member that says nothing keeps what it has.
 *   Opt out in `.config/repo/socket-wheelhouse.json`:
 *   { "release": { "github": false } }
 *   Usage: node scripts/fleet/release/github-release-enabled.mts
 *   Prints `true` / `false`, and writes `enabled=<value>` to GITHUB_OUTPUT
 *   when the workflow runs it.
 */

import { appendFileSync } from 'node:fs'
import process from 'node:process'

import { isMainModule } from '../_shared/is-main-module.mts'
import { loadSocketWheelhouseConfig, REPO_ROOT } from '../paths.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

/**
 * Read the `release.github` flag out of an already-parsed settings object.
 *
 * Defaults to TRUE for every shape that is not an explicit `false`: absent
 * config, absent section, a non-boolean value. A repo that never mentions the
 * flag keeps cutting releases, so adding this switch cannot silently retire a
 * member's release channel — only an explicit `false` does.
 */
export function githubReleaseEnabled(config: unknown): boolean {
  const release = (config as { release?: unknown | undefined } | undefined)
    ?.release
  const flag = (release as { github?: unknown | undefined } | undefined)?.github
  return flag !== false
}

function main(): void {
  const loaded = loadSocketWheelhouseConfig(REPO_ROOT)
  const enabled = githubReleaseEnabled(loaded?.value)
  const value = enabled ? 'true' : 'false'
  process.stdout.write(`${value}\n`)
  const out = process.env['GITHUB_OUTPUT']
  if (out) {
    appendFileSync(out, `enabled=${value}\n`)
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'prints whether this repo cuts GitHub Releases',
  help: `Usage: node scripts/fleet/release/github-release-enabled.mts

Reads release.github from .config/repo/socket-wheelhouse.json. Defaults to
true, so only an explicit false opts a repo out.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
