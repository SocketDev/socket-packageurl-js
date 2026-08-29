#!/usr/bin/env node
/*
 * @file Code-is-law third layer for the `no-pm-exec-guard` discipline. The
 *   hook (`.claude/hooks/fleet/no-pm-exec-guard/`) blocks a banned run form at
 *   Bash time, and the `socket/no-npx-dlx` oxlint rule catches the npx/pnx/
 *   bunx/dlx spellings inside JS/TS string literals — but neither surface
 *   fires on a shell script, a GitHub Actions workflow `run:` step, or a
 *   `package.json` `scripts` entry: none of those is a live Claude Bash call
 *   or a JS/TS AST node. A banned form committed into one of those files runs
 *   every time CI or a contributor invokes it, unreviewed by either existing
 *   layer. This script is that third layer, wired into `check --all` per
 *   `docs/agents.md/fleet/code-is-law.md`'s "pick the layers that fire where
 *   the violation happens."
 *
 *   Scans three surfaces:
 *     - `*.sh` / `*.bash` — line-scanned raw text, same crude-but-effective
 *       approach `pnpm-run-flags-have-no-bare-dash.mts` uses for YAML.
 *     - `.github/workflows/*.yml` / `*.yaml` — line-scanned raw text (no YAML
 *       parse; a `run:` step body is just shell text either way).
 *     - every tracked `package.json`'s `scripts` object VALUES, parsed as
 *       JSON so a dependency or script NAME that happens to contain a banned
 *       substring (an npm package literally named `bunx-something`) is never
 *       mistaken for an invocation.
 *
 *   Deliberately does NOT scan `.md` / docs: those are prose describing the
 *   ban, not executable surfaces, and a raw substring scan there would trip
 *   on this very file's own doc comments and every README that mentions the
 *   rule. `.mts`/`.ts` source is the oxlint rule's job, not this script's —
 *   scanning it here too would just duplicate that rule's detection with a
 *   cruder regex and let the two drift.
 *
 *   Bypass: `suppressionWaives(text, 'socket/no-fetch-exec-in-committed-files')`
 *   — an `oxlint-disable-next-line socket/no-fetch-exec-in-committed-files --
 *   <reason>` comment on the line above a hit. oxlint itself never runs on
 *   `.sh` files, so this is a fleet-only marker riding the shared suppression
 *   syntax (see `_shared/suppression-rules.mts`), same as the other
 *   workflow-YAML scanners that have no real oxlint rule behind their name.
 *
 *   Exit: 0 clean; 1 at least one occurrence.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  suppressionWaivesNextLine,
  suppressionWaivesOwnLine,
} from '../../../.claude/hooks/fleet/_shared/suppression-rules.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const RULE_NAME = 'socket/no-fetch-exec-in-committed-files'

// Mirrors `no-pm-exec-guard`'s two banned categories: the overhead wrappers
// (`<pm> exec`) and the fetch+execute forms (`npx`/`pnx`/`bunx`/`dlx`/
// `<pm> create`). The trailing `(?=\s|$)` — not `\b` — matters: `\b` treats
// the boundary between a word char and `-` as a boundary too, so `\bexec\b`
// would false-match a real script named `exec-migrate-db` invoked as the
// pnpm-shorthand `pnpm exec-migrate-db`. Requiring whitespace-or-end after the
// keyword rules that out.
const BANNED: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bpnpm\s+exec(?=\s|$)/, label: 'pnpm exec' },
  { re: /\bnpm\s+exec(?=\s|$)/, label: 'npm exec' },
  { re: /\byarn\s+exec(?=\s|$)/, label: 'yarn exec' },
  { re: /\bpnpm\s+dlx(?=\s|$)/, label: 'pnpm dlx' },
  { re: /\byarn\s+dlx(?=\s|$)/, label: 'yarn dlx' },
  { re: /\bbun\s+x(?=\s|$)/, label: 'bun x' },
  { re: /\bnpm\s+create(?=\s|$)/, label: 'npm create' },
  { re: /\bpnpm\s+create(?=\s|$)/, label: 'pnpm create' },
  { re: /\byarn\s+create(?=\s|$)/, label: 'yarn create' },
  { re: /\bbun\s+create(?=\s|$)/, label: 'bun create' },
  // Bare-binary forms — no subcommand to anchor on, so the boundary check is
  // symmetric: whitespace/start on the left too. `\b` alone is NOT enough
  // there: `=` is a non-word char, so `\b` is satisfied inside
  // `SOCKET_CLI_MODE=npx` (an env-var VALUE, never an invocation) — the
  // explicit `(?:^|\s)` on the left rules that out; the right side keeps the
  // `-`-tolerant lookahead.
  { re: /(?:^|\s)bunx(?=\s|$)/, label: 'bunx' },
  // oxlint-disable-next-line socket/no-npx-dlx -- matcher, not an invocation
  { re: /(?:^|\s)npx(?=\s|$)/, label: 'npx' },
  { re: /(?:^|\s)pnx(?=\s|$)/, label: 'pnx' },
]

export type FetchExecHit = {
  file: string
  line: number
  label: string
  text: string
}

/**
 * Every offending line in `text`, honoring the shared
 * `oxlint-disable-next-line socket/no-fetch-exec-in-committed-files` bypass
 * on the line immediately above a hit. Pure, so the suite drives it without a
 * repo.
 */
export function findFetchExecLines(file: string, text: string): FetchExecHit[] {
  const out: FetchExecHit[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    for (
      let j = 0, { length: bannedLength } = BANNED;
      j < bannedLength;
      j += 1
    ) {
      const { re, label } = BANNED[j]!
      if (!re.test(line)) {
        continue
      }
      const prev = i > 0 ? lines[i - 1]! : ''
      if (
        suppressionWaivesNextLine(prev, RULE_NAME) ||
        suppressionWaivesOwnLine(line, RULE_NAME)
      ) {
        continue
      }
      out.push({ file, line: i + 1, label, text: line.trim() })
      break
    }
  }
  return out
}

/**
 * Every `scripts.<key>` value in a `package.json` body that matches a banned
 * form. Parses JSON rather than substring-scanning the raw file, so a
 * dependency or devDependency literally named e.g. `bunx-something` is never
 * mistaken for the `bunx` command. Returns [] on any parse failure or a
 * missing/malformed `scripts` field — a check script fails closed on its own
 * detection, never on an unrelated JSON shape.
 */
export function findFetchExecInPackageScripts(
  file: string,
  text: string,
): FetchExecHit[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return []
  }
  const scripts = (parsed as Record<string, unknown>)['scripts']
  if (typeof scripts !== 'object' || scripts === null) {
    return []
  }
  const out: FetchExecHit[] = []
  for (const [key, value] of Object.entries(
    scripts as Record<string, unknown>,
  )) {
    if (typeof value !== 'string') {
      continue
    }
    for (
      let j = 0, { length: bannedLength } = BANNED;
      j < bannedLength;
      j += 1
    ) {
      const { re, label } = BANNED[j]!
      if (re.test(value)) {
        out.push({ file, line: 0, label, text: `scripts.${key}: ${value}` })
        break
      }
    }
  }
  return out
}

// Test fixtures need to SPELL the banned forms to exercise the hook / lint
// rule suites; flagging those here is noise on files that are themselves the
// suite for a DIFFERENT enforcer, not a real committed invocation.
const SKIP_RE = /(?:^|\/)test\//

/**
 * Tracked shell scripts, workflow YAML, and package.json files. Sourced from
 * git so vendored and ignored trees never enter the sweep.
 */
async function trackedFiles(): Promise<string[]> {
  const result = await spawn(
    'git',
    [
      'ls-files',
      '-z',
      '*.sh',
      '*.bash',
      '.github/workflows/*.yml',
      '.github/workflows/*.yaml',
      '*package.json',
    ],
    { cwd: REPO_ROOT, stdioString: true },
  )
  return (
    String(result.stdout ?? '')
      .split('\0')
      .filter(Boolean)
      // `*package.json` also matches e.g. `foo-package.json`; keep exact
      // basename matches only.
      .filter(
        rel => path.basename(rel) === 'package.json' || !rel.endsWith('.json'),
      )
  )
}

export async function main(): Promise<void> {
  const hits: FetchExecHit[] = []
  const files = await trackedFiles()
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    if (SKIP_RE.test(rel)) {
      continue
    }
    const abs = path.join(REPO_ROOT, rel)
    if (!existsSync(abs)) {
      continue
    }
    let text = ''
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    if (path.basename(rel) === 'package.json') {
      hits.push(...findFetchExecInPackageScripts(rel, text))
    } else {
      hits.push(...findFetchExecLines(rel, text))
    }
  }
  if (!hits.length) {
    logger.success(
      '[check-committed-scripts-have-no-fetch-exec] no banned `<pm> exec`/`dlx`/`npx`/`pnx`/`bunx`/`create` invocation in a shell script, workflow, or package.json script.',
    )
    return
  }
  logger.fail(
    '[check-committed-scripts-have-no-fetch-exec] banned run form committed into a shell script, workflow, or package.json script.',
  )
  logger.log('')
  logger.log(
    '  These surfaces run at CI/contributor time regardless of the Bash-time hook',
  )
  logger.log(
    '  or the JS/TS-literal lint rule — neither fires on a .sh file, a workflow',
  )
  logger.log('  `run:` step, or a package.json script.')
  logger.log('')
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    const where = hit.line > 0 ? `${hit.file}:${hit.line}` : hit.file
    logger.log(`    ${where}: [${hit.label}] ${hit.text}`)
  }
  logger.log('')
  logger.log(
    '  Fix: add the dep and run it installed (node_modules/.bin/<tool> or pnpm run <script>).',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks no shell script, workflow, or package.json script commits `<pm> exec`/`dlx`/`npx`/`pnx`/`bunx`/`create`',
  help: `Usage: node scripts/fleet/check/committed-scripts-have-no-fetch-exec.mts`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
