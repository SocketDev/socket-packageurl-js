#!/usr/bin/env node
/*
 * @file `check --all` compliance guard: `pnpm run format` (oxfmt --write via
 *   scripts/fleet/format.mts) must reach a fixed point in ONE invocation on a
 *   JSDoc comment that oxfmt rewraps non-idempotently. oxfmt's
 *   `jsdoc.lineWrappingStyle: "balance"` rewraps a `- ` list-item marker to a
 *   line start only on the second pass, so a single `--write` leaves a file
 *   `--check` then rejects (oxc-project/oxc#25825). format.mts loops
 *   `--write`/`--check` until convergence to mask that; this guard asserts the
 *   loop is present and working, so removing it fails the gate rather than
 *   silently reintroducing the broken `--write`-then-`--check` contract that
 *   pre-commit hooks and CI rely on.
 *
 *   It writes a fixture that triggers the non-idempotent rewrap to a temp file,
 *   runs format.mts (write) on it, then format.mts --check, and fails unless
 *   both pass. The fixture is a generic JSDoc comment (no fleet content) so the
 *   guard stays about the formatter, not any one source file.
 *
 *   Exit: 0 - one format.mts invocation converges and --check accepts it; 1 - it
 *   does not, meaning the convergence loop in format.mts is missing or broken.
 *
 *   Usage: node scripts/fleet/check/format-write-is-convergent.mts [--quiet]
 */

import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

// A JSDoc comment oxfmt rewraps non-idempotently: the `- 500 ...` fragment lands
// at a line start after the first pass, so a second pass inserts a list-item
// paragraph break the first did not. Generic content - no fleet identifiers.
const FIXTURE = `/**
 * @file The pure layer of the config-loader system: the per-handler quota
 *   shapes, the payer roles, the model-name helpers, and the tally that turns
 *   Database message rows into per-handler spend. The I/O that reads those
 *   rows from SQLite and the providers' own surfaces lives in \`config-loader-read.mts\`
 *   so this module can be imported by a SQLite-free renderer (the natively-built
 *   statusline entry) without pulling \`node:sqlite\` or the credential-backed
 *   readers into it. EVERY PROVIDER HAS A DIFFERENT METER. Fireworks bills
 *   dollars. Synthetic sells a REQUEST rate - 500 per rolling 5 hours - so a
 *   dollar gauge over it would fill on the wrong axis and read full right up
 *   until the requests ran out.
 */
export const value = 1
`

function runFormat(args: readonly string[]): number {
  const res = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts', 'fleet', 'format.mts'), ...args],
    { stdio: 'pipe' },
  )
  return res.status ?? 1
}

export function main(): number {
  const tmp = path.join(
    os.tmpdir(),
    `format-write-converges-on-repeat-${process.pid}.ts`,
  )
  writeFileSync(tmp, FIXTURE, 'utf8')
  try {
    // One write invocation must converge (format.mts loops --write/--check).
    const writeStatus = runFormat([tmp])
    if (writeStatus !== 0) {
      process.stderr.write(
        `format.mts --write did not converge on the non-idempotent fixture (exit ${writeStatus}). The convergence loop in scripts/fleet/format.mts is missing or broken. See https://github.com/oxc-project/oxc/issues/25825\n`,
      )
      return 1
    }
    // The result must be check-clean.
    const checkStatus = runFormat(['--check', tmp])
    if (checkStatus !== 0) {
      process.stderr.write(
        `format.mts --check rejects the output of format.mts --write on the non-idempotent fixture (exit ${checkStatus}). See https://github.com/oxc-project/oxc/issues/25825\n`,
      )
      return 1
    }
    return 0
  } finally {
    safeDeleteSync(tmp)
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'compliance guard: one pnpm run format invocation converges on a JSDoc comment oxfmt rewraps non-idempotently (oxc-project/oxc#25825)',
  help: `Usage: node scripts/fleet/check/format-write-is-convergent.mts [--quiet]

Asserts the format.mts convergence loop is present and working. Fails if a
single format.mts --write does not produce output format.mts --check accepts.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
