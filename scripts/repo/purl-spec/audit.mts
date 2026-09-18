import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { parseGitmodules } from '../../fleet/git/modules.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'
import type { ScriptResult } from '../../fleet/process/script-result.mts'
import {
  GITMODULES_PATH,
  PURL_DIST_ENTRY,
  PURL_SPEC_DRAFT_RELATIVE_PATH,
  PURL_SPEC_UPSTREAM_RELATIVE_PATH,
  REPO_ROOT,
} from '../paths.mts'
import { evaluatePurlCase } from './evaluate.mts'
import type { PurlCaseResult, PurlFactory } from './evaluate.mts'
import { loadPurlSpecCases } from './load.mts'
import type { PurlSpecCase } from './load.mts'

export interface PurlAuditResult {
  total: number
  passed: number
  differences: Array<PurlSpecCase & { result: PurlCaseResult }>
}

export function auditPurlCases(
  cases: PurlSpecCase[],
  factory: PurlFactory,
): PurlAuditResult {
  const differences: PurlAuditResult['differences'] = []
  for (let index = 0, { length } = cases; index < length; index += 1) {
    const entry = cases[index]!
    const result = evaluatePurlCase(entry.test, factory)
    if (!result.passed) {
      differences.push({ ...entry, result })
    }
  }
  return {
    total: cases.length,
    passed: cases.length - differences.length,
    differences,
  }
}

export async function main(): Promise<ScriptResult> {
  const entries = parseGitmodules(await fs.readFile(GITMODULES_PATH, 'utf8'))
  const sources = []
  for (const relativePath of [
    PURL_SPEC_UPSTREAM_RELATIVE_PATH,
    PURL_SPEC_DRAFT_RELATIVE_PATH,
  ]) {
    const entry = entries.find(item => item.path === relativePath)
    if (!entry?.ref) {
      throw new Error(
        `Missing PURL audit pin at ${relativePath}; restore .gitmodules.`,
      )
    }
    const directory = path.join(REPO_ROOT, relativePath)
    const head = await spawn('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      stdioString: true,
    })
    const status = await spawn('git', ['status', '--porcelain'], {
      cwd: directory,
      stdioString: true,
    })
    if (
      head.code !== 0 ||
      head.stdout.trim() !== entry.ref ||
      status.code !== 0 ||
      status.stdout.trim()
    ) {
      throw new Error(
        `PURL audit source is not the clean pinned revision. Where: ${directory}. Saw: missing, changed, or mismatched checkout; wanted: ${entry.ref}. Fix: materialize the reviewed upstream reference.`,
      )
    }
    sources.push({
      source: relativePath,
      ref: entry.ref,
      cases: await loadPurlSpecCases(path.join(directory, 'tests')),
    })
  }
  const build = await spawn('pnpm', ['run', 'build'], {
    cwd: REPO_ROOT,
    stdioString: true,
  })
  if (build.code !== 0) {
    throw new Error(
      `Cannot audit current PURL code. Build exited ${build.code}. ${build.stderr}`,
    )
  }
  const artifact = (await import(pathToFileURL(PURL_DIST_ENTRY).href)) as {
    PackageURL: PurlFactory
  }
  const results = sources.map(source => ({
    __proto__: null,
    source: source.source,
    ref: source.ref,
    ...auditPurlCases(source.cases, artifact.PackageURL),
  }))
  const differences = results.reduce(
    (count, result) => count + result.differences.length,
    0,
  )
  return {
    exitCode: differences ? 1 : 0,
    data: results,
    ...(differences
      ? {
          error: `PURL audit found ${differences} raw fixture differences. Review audit:purl-spec --json for the original expectations and current results.`,
        }
      : {}),
  }
}

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe:
      'audits original published and draft PURL fixtures against the current local build',
    help: 'Usage: pnpm run audit:purl-spec [--json]\nAudits every fixture without applying rule corrections. Requires the pinned upstream sources to be materialized.',
    json: 'result',
    heavyJob: 'test',
  })
}
