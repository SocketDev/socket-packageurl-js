// Fleet check — no committed surface points at a China-jurisdiction AI endpoint.
//
// WHAT THIS IS ABOUT, precisely: WHERE INFERENCE RUNS, never where a model's
// weights came from. Kimi, DeepSeek, Qwen, GLM and MiniMax are open weights, and
// served by Fireworks or Synthetic - both US - a prompt and the source it
// carries never leave US infrastructure. Those are fine, and this check must
// never flag them, or it trains the reader to skip it.
//
// What is NOT fine is a first-party endpoint: `api.moonshot.cn`, `kimi.com`,
// `api.deepseek.com` and their siblings take the prompt directly to a Chinese
// operator. That is a data-residency question rather than a cost or quality one,
// so it is a hard fail rather than a preference.
//
// The ban list is HOSTS, not vendor names. A vendor name matches prose, a model
// id and a comment; a hostname only matches something a request can actually be
// sent to. That is what keeps this quiet enough to be worth reading.
//
// Exit codes: 0 — no committed surface names a banned endpoint; 1 — at least one
// does.
//
// Usage: node scripts/fleet/check/endpoints-are-outside-china-jurisdiction.mts [--quiet]

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { escapeRegExp } from '@socketsecurity/lib-stable/regexps/escape'

import { isMainModule } from '../process/is-main-module.mts'
import { runMain } from '../process/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../process/run-main.mts'

const logger = getDefaultLogger()

/**
 * First-party AI endpoints operated from mainland China.
 *
 * Hosts only. Each entry is something a request can be addressed to, so a
 * mention of the vendor in prose, a model id, or a comment explaining this very
 * rule does not trip it.
 */
export const CHINA_ENDPOINT_HOSTS: readonly string[] = [
  // Moonshot / Kimi
  'api.moonshot.cn',
  'api.moonshot.ai',
  'kimi.com',
  'kimi.moonshot.cn',
  // DeepSeek
  'api.deepseek.com',
  'deepseek.com',
  // Alibaba / Qwen — DashScope is the first-party gateway
  'dashscope.aliyuncs.com',
  'dashscope-intl.aliyuncs.com',
  // Zhipu / GLM
  'open.bigmodel.cn',
  'bigmodel.cn',
  // MiniMax
  'api.minimax.chat',
  'api.minimaxi.com',
  // Baidu ERNIE
  'aip.baidubce.com',
  // ByteDance Doubao / Volcano Engine
  'ark.cn-beijing.volces.com',
  // 01.AI / Yi
  'api.lingyiwanwu.com',
  // StepFun
  'api.stepfun.com',
  // Tencent Hunyuan
  'hunyuan.tencentcloudapi.com',
]

const SCAN_GLOBS = [
  '.claude/**/*.{json,md,mts,toml}',
  '.config/**/*.{json,toml,yaml,yml}',
  '.github/**/*.{yaml,yml}',
  'scripts/**/*.{json,mts}',
  'template/**/*.{json,md,mts,toml}',
] as const

const IGNORE_GLOBS = [
  '**/build/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/test/**',
  '**/*.test.mts',
  // This file lists the hosts it bans.
  '**/check/endpoints-are-outside-china-jurisdiction.mts',
  // A git worktree under .claude/worktrees/ is local runtime state, not a
  // committed surface; its checkout includes this check script and its tests.
  '.claude/worktrees/**',
] as const

export interface EndpointFinding {
  readonly file: string
  readonly host: string
  readonly line: number
}

/**
 * 1-based line number of a byte offset.
 */
export function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') {
      line += 1
    }
  }
  return line
}

/**
 * Every banned host named in one file's text.
 *
 * A host must be bounded by something that is not a hostname character - and a
 * DOT counts as one, on both sides. `api.deepseek.com/v1` matches;
 * `not-api.deepseek.com` and `api.deepseek.com.deny.test` do not, because
 * neither is that host. The trailing dot was missed first time round, so a
 * lookalike subdomain under someone else's domain read as a hit.
 */
export function scanEndpoints(
  text: string,
  file: string,
  hosts: readonly string[] = CHINA_ENDPOINT_HOSTS,
): EndpointFinding[] {
  const out: EndpointFinding[] = []
  for (let i = 0, { length } = hosts; i < length; i += 1) {
    const host = hosts[i]!
    const pattern = new RegExp(
      `(?<![A-Za-z0-9.-])${escapeRegExp(host)}(?![A-Za-z0-9.-])`,
      'g',
    )
    for (const match of text.matchAll(pattern)) {
      out.push({ file, host, line: lineOf(text, match.index ?? 0) })
    }
  }
  return out
}

export function main(): void {
  const quiet = process.argv.includes('--quiet')
  const files = globSync([...SCAN_GLOBS], {
    cwd: REPO_ROOT,
    ignore: [...IGNORE_GLOBS],
  })
  const findings: EndpointFinding[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let text = ''
    try {
      text = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
    } catch {
      continue
    }
    findings.push(...scanEndpoints(text, rel))
  }

  if (findings.length) {
    logger.fail(
      `[endpoints-are-outside-china-jurisdiction] ${findings.length} reference(s) to a China-jurisdiction AI endpoint:`,
    )
    logger.group('findings')
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const finding = findings[i]!
      logger.substep(`${finding.file}:${finding.line} — ${finding.host}`)
    }
    logger.substep(
      'Fix: route the model through a US host instead. Fireworks and Synthetic serve the same open weights, and a prompt sent to them never leaves US infrastructure.',
    )
    logger.groupEnd()
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[endpoints-are-outside-china-jurisdiction] no committed surface points at one.',
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks that no committed surface points at a China-jurisdiction AI endpoint',
  help: `Usage: node scripts/fleet/check/endpoints-are-outside-china-jurisdiction.mts [--quiet]

  --quiet  suppress the success line

Bans HOSTS, not vendors. Kimi and DeepSeek weights served by Fireworks or
Synthetic are US-hosted and never flagged: what matters is where inference
runs, not where the weights came from.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
