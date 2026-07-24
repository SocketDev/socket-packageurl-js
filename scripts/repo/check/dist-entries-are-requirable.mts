/**
 * @file Repo-owned check: every published entry point must load in a child
 *   Node.js process. The exports map's runtime targets — every `default` /
 *   `require` / `import` / `node` condition value plus bare-string subpaths
 *   and `main` — are each require()d (and, for JS targets, also dynamically
 *   import()ed) in a fresh `node` child so a module-scope crash surfaces here
 *   instead of in a consumer. Motivating defect: 1.4.5 shipped a
 *   dist/exists.js that threw `TypeError: node.satisfies is not a function`
 *   at require time — rolldown re-mangled a nested pre-bundled scope and
 *   collided two `require_node*` factory bindings — while dist/index.js and
 *   the whole test suite stayed green because nothing ever loaded the built
 *   exists entry. `types` and `source` conditions are skipped: they are not
 *   runtime targets. Skips cleanly when dist/ has not been built (a lint/type
 *   CI lane); once dist/ exists every target must be present AND loadable.
 *   Runs in `check --all` via repo-check discovery, which gates both CI
 *   (build runs first) and the staged-publish workflow's ci-validate path.
 *   Usage: node scripts/repo/check/dist-entries-are-requirable.mts [--quiet]
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../../fleet/paths.mts'

const logger = getDefaultLogger()

// Condition keys whose values are never loaded at runtime.
const NON_RUNTIME_CONDITIONS: ReadonlySet<string> = new Set(['source', 'types'])

export interface EntryProbeFailure {
  readonly mode: 'import' | 'require'
  readonly stderr: string
  readonly target: string
}

export interface PackageJsonEntries {
  exports?: unknown | undefined
  main?: unknown | undefined
}

/**
 * Collect every runtime target from a package.json `exports` map plus `main`,
 * as sorted unique package-relative paths. Walks nested condition objects,
 * skipping `types`/`source` values and declaration files. Pure.
 */
export function collectRuntimeTargets(pkg: PackageJsonEntries): string[] {
  const targets = new Set<string>()
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      // Declaration files can appear as bare values; they are not runtime
      // loadable modules.
      if (!/\.d\.(?:c|m)?ts$/.test(node)) {
        targets.add(node)
      }
      return
    }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const entries = Object.entries(node as Record<string, unknown>)
      for (let i = 0, { length } = entries; i < length; i += 1) {
        const [key, value] = entries[i]
        // Subpath keys start with '.'; anything else is a condition name.
        if (!key.startsWith('.') && NON_RUNTIME_CONDITIONS.has(key)) {
          continue
        }
        visit(value)
      }
    }
  }
  visit(pkg.exports)
  if (typeof pkg.main === 'string') {
    targets.add(pkg.main)
  }
  return [...targets].toSorted()
}

/**
 * Load one target in a fresh child `node` process, via require() and — for JS
 * targets — dynamic import(). Returns the failures ([] = loadable). JSON
 * targets get the require() probe only: import()ing JSON needs an import
 * attribute and is not the shipped consumption mode.
 */
export function probeEntry(absTarget: string): EntryProbeFailure[] {
  const failures: EntryProbeFailure[] = []
  const isMjs = absTarget.endsWith('.mjs')
  const isJson = absTarget.endsWith('.json')
  const probes: Array<{ args: string[]; mode: 'import' | 'require' }> = []
  if (!isMjs) {
    probes.push({
      args: ['-e', `require(${JSON.stringify(absTarget)})`],
      mode: 'require',
    })
  }
  if (!isJson) {
    probes.push({
      args: [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(absTarget)})`,
      ],
      mode: 'import',
    })
  }
  for (let i = 0, { length } = probes; i < length; i += 1) {
    const probe = probes[i]
    const result = spawnSync(process.execPath, probe.args, {
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (result.status !== 0) {
      failures.push({
        mode: probe.mode,
        stderr: (result.stderr || result.error?.message || '').trim(),
        target: absTarget,
      })
    }
  }
  return failures
}

/**
 * Run the check against `repoRoot`, returning the exit code. Split from
 * `main()` so tests can drive it directly. Skips cleanly (0) when dist/ has
 * not been built.
 */
export function runCheck(
  repoRoot: string,
  options?: { quiet?: boolean | undefined } | undefined,
): number {
  const { quiet = false } = { __proto__: null, ...options }
  const pkgJsonPath = path.join(repoRoot, 'package.json')
  const pkg = JSON.parse(
    readFileSync(pkgJsonPath, 'utf8'),
  ) as PackageJsonEntries
  const targets = collectRuntimeTargets(pkg)
  if (targets.length === 0) {
    if (!quiet) {
      logger.success(
        '[dist-entries-are-requirable] no runtime entry targets declared.',
      )
    }
    return 0
  }

  if (!existsSync(path.join(repoRoot, 'dist'))) {
    if (!quiet) {
      logger.log(
        '[dist-entries-are-requirable] dist/ not built — skipping (build lanes enforce this gate).',
      )
    }
    return 0
  }

  const failures: EntryProbeFailure[] = []
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]
    const abs = path.join(repoRoot, target)
    if (!existsSync(abs)) {
      failures.push({
        mode: 'require',
        stderr: 'file does not exist',
        target: abs,
      })
      continue
    }
    failures.push(...probeEntry(abs))
  }

  if (failures.length) {
    logger.fail(
      '[dist-entries-are-requirable] published entry points that crash on load:',
    )
    for (let i = 0, { length } = failures; i < length; i += 1) {
      const f = failures[i]
      logger.error(`  ✗ ${f.mode}(${path.relative(repoRoot, f.target)})`)
      const stderrLines = f.stderr.split('\n').slice(0, 6)
      for (let j = 0, { length: jlen } = stderrLines; j < jlen; j += 1) {
        logger.error(`    ${stderrLines[j]}`)
      }
    }
    logger.error(
      '  Fix: every exports-map runtime target must load cleanly — rebuild and inspect the failing entry; a require-crash here would ship to every consumer.',
    )
    return 1
  }

  if (!quiet) {
    logger.success(
      `[dist-entries-are-requirable] all ${targets.length} published entry targets load cleanly.`,
    )
  }
  return 0
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  process.exitCode = runCheck(REPO_ROOT, { quiet })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
