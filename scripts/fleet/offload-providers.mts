#!/usr/bin/env node
/**
 * @file `offload-providers` — which providers work can be offloaded to, what
 *   they reach, and what that has cost.
 *   WHY A SCRIPT. "Is Fireworks wired up?" was answered by hand four times in
 *   one session, each time by running three commands and reading three
 *   different output shapes. The answer is deterministic, so it is a script.
 *   NO SECRET IS EVER READ. The credentials live in OpenCode's own store and
 *   this only ever asks `opencode` what it HAS, never what the value is. The
 *   store's path is not repeated here either: `opencode auth list` is the one
 *   surface, and a second copy of a secret's location is a second place to
 *   leak it from.
 *   HEADLESS IS SPLIT. `opencode run` is fully non-interactive - it is how a
 *   subagent offloads work with no TTY at all. `opencode auth login` is NOT:
 *   with stdin closed it falls through to an API-key prompt rather than
 *   opening a browser, so a provider whose only path is OAuth cannot be
 *   logged in from here. That is why this script REPORTS a missing provider
 *   with the command to run rather than trying to run it.
 *   Usage:
 *   node scripts/fleet/offload-providers.mts
 *   node scripts/fleet/offload-providers.mts --require fireworks,synthetic.
 */

import process from 'node:process'

import { parseArgs } from 'node:util'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from './process/is-main-module.mts'
import { runMain } from './process/run-main.mts'

import type { ScriptMeta } from './process/run-main.mts'

const logger = getDefaultLogger()

const EXIT_MISSING_PROVIDER = 2

/**
 * A provider offload can route to, and how to name it to `opencode`.
 */
export interface OffloadProvider {
  // Which CLI holds this provider's credential. Not every offload target lives
  // in OpenCode: OpenAI is reached through the Codex CLI on a ChatGPT
  // subscription, which OpenCode's provider list has no entry for.
  readonly cli: 'codex' | 'opencode'
  // Substring matched against the CLI's auth output, lowercased.
  readonly credentialLabel: string
  readonly id: string
  // Prefix every one of its model ids carries in `opencode models`. Empty for a
  // provider OpenCode does not enumerate.
  readonly modelPrefix: string
}

/**
 * The providers worth offloading to, and the two that would help most if they
 * were wired.
 *
 * Anthropic and OpenAI are listed even though neither is authenticated: naming
 * them is how the report says what is MISSING rather than only what is present,
 * and a personal subscription absorbing work is the whole point of adding one.
 */
export const OFFLOAD_PROVIDERS: readonly OffloadProvider[] = [
  {
    cli: 'opencode',
    credentialLabel: 'fireworks',
    id: 'fireworks',
    modelPrefix: 'fireworks-ai/',
  },
  {
    cli: 'opencode',
    credentialLabel: 'synthetic',
    id: 'synthetic',
    modelPrefix: 'synthetic/',
  },
  {
    cli: 'opencode',
    credentialLabel: 'anthropic',
    id: 'anthropic',
    modelPrefix: 'anthropic/',
  },
  // Codex, not OpenCode, and on a ChatGPT SUBSCRIPTION rather than an API key.
  // `codex login status` prints "Logged in using ChatGPT" for that seat.
  {
    cli: 'codex',
    credentialLabel: 'logged in',
    id: 'openai',
    modelPrefix: '',
  },
]

export interface ProviderStatus {
  readonly authenticated: boolean
  readonly id: string
  readonly modelCount: number
}

/**
 * Run an `opencode` subcommand and return its stdout, or undefined when the
 * binary is absent or the call fails.
 *
 * Absent is a real answer rather than an error: a machine with no OpenCode
 * installed has no offload path, and saying so is more useful than a stack
 * trace about a missing binary.
 */
export async function cliOutput(
  command: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    const result = await spawn(command, [...args], { stdioString: true })
    // BOTH streams. `codex login status` prints its verdict on stderr, and
    // reading only stdout reported a logged-in seat as having no credential -
    // which then told the reader to run a login they had already done. Where a
    // status line lands is not something to assume.
    const out = typeof result.stdout === 'string' ? result.stdout : ''
    const err = typeof result.stderr === 'string' ? result.stderr : ''
    const combined = `${out}\n${err}`
    return combined.trim().length > 0 ? combined : undefined
  } catch {
    return undefined
  }
}

export async function opencodeOutput(
  args: readonly string[],
): Promise<string | undefined> {
  return await cliOutput('opencode', args)
}

/**
 * Which providers hold a credential, read from `opencode auth list`.
 *
 * Matched on the provider's LABEL, never on the value beside it: the list
 * prints one line per credential and the value is not on it, but matching a
 * label keeps that true even if the format changes.
 */
export function authenticatedProviders(
  authOutput: string,
  codexOutput = '',
  providers: readonly OffloadProvider[] = OFFLOAD_PROVIDERS,
): Set<string> {
  const opencodeHay = authOutput.toLowerCase()
  const codexHay = codexOutput.toLowerCase()
  const found = new Set<string>()
  for (const provider of providers) {
    const haystack = provider.cli === 'codex' ? codexHay : opencodeHay
    if (haystack.includes(provider.credentialLabel)) {
      found.add(provider.id)
    }
  }
  return found
}

/**
 * How many models each provider currently exposes.
 */
export function modelCounts(
  modelsOutput: string,
  providers: readonly OffloadProvider[] = OFFLOAD_PROVIDERS,
): Map<string, number> {
  const lines = modelsOutput.split(/\r?\n/).map(line => line.trim())
  const counts = new Map<string, number>()
  for (const provider of providers) {
    // An EMPTY prefix means OpenCode does not enumerate this provider, not that
    // every model belongs to it. Left to startsWith('') it matched every line
    // and reported the whole catalogue as one provider's.
    counts.set(
      provider.id,
      provider.modelPrefix.length === 0
        ? 0
        : lines.filter(line => line.startsWith(provider.modelPrefix)).length,
    )
  }
  return counts
}

/**
 * The login command for a provider that has no credential.
 *
 * `-p` skips the provider-selection menu, which is the part that cannot be
 * driven without a TTY. The browser step still cannot be, which is why this is
 * a string to hand over rather than something to run.
 */
export function loginCommand(
  providerId: string,
  providers: readonly OffloadProvider[] = OFFLOAD_PROVIDERS,
): string {
  const provider = providers.find(entry => entry.id === providerId)
  // Device auth prints a code and a URL and waits, so unlike OpenCode's browser
  // flow it can at least be STARTED from a script - the code is still entered
  // by a human elsewhere.
  return provider?.cli === 'codex'
    ? 'codex login --device-auth'
    : `opencode auth login -p ${providerId}`
}

/**
 * The offloaded spend line from `opencode stats`, or undefined when it says
 * nothing about cost. Reported beside the providers because offloading is only
 * worth claiming if what moved can be measured.
 */
export function totalCostLine(statsOutput: string): string | undefined {
  const lines = statsOutput.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.replace(/[│┌┐└┘├┤─]/g, ' ').trim()
    if (/^total cost/i.test(line)) {
      return line.replace(/\s+/g, ' ')
    }
  }
  return undefined
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { require: { type: 'string' } },
    strict: false,
  })

  let auth: string | undefined
  let codex: string | undefined
  let models: string | undefined
  let stats: string | undefined
  try {
    ;[auth, models, stats] = await Promise.all([
      opencodeOutput(['auth', 'list']),
      opencodeOutput(['models']),
      opencodeOutput(['stats']),
    ])
    codex = await cliOutput('codex', ['login', 'status'])
  } catch (e) {
    logger.fail(
      `Could not ask opencode about its providers: ${errorMessage(e)}`,
    )
    return 1
  }

  if (auth === undefined) {
    logger.fail(
      'No offload path on this machine.\n' +
        'Where: the `opencode` binary\n' +
        'Saw: it is not installed, or it failed to run\n' +
        'Fix: install OpenCode, then re-run this',
    )
    return 1
  }

  const authed = authenticatedProviders(auth, codex ?? '')
  const counts = modelCounts(models ?? '')
  const statuses: ProviderStatus[] = OFFLOAD_PROVIDERS.map(provider => ({
    authenticated: authed.has(provider.id),
    id: provider.id,
    modelCount: counts.get(provider.id) ?? 0,
  }))

  logger.group('offload providers')
  for (let i = 0, { length } = statuses; i < length; i += 1) {
    const status = statuses[i]!
    logger.substep(
      status.authenticated
        ? `${status.id}: ready${status.modelCount > 0 ? `, ${status.modelCount} model(s)` : ''}`
        : `${status.id}: no credential — ${loginCommand(status.id)}`,
    )
  }
  const cost = stats ? totalCostLine(stats) : undefined
  if (cost) {
    logger.substep(`offloaded so far: ${cost}`)
  }
  logger.groupEnd()

  const required = String(values['require'] ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
  const missing = required.filter(id => !authed.has(id))
  if (missing.length) {
    logger.fail(
      `Required offload provider(s) not authenticated: ${missing.join(', ')}.\n` +
        `Fix: ${missing.map(id => loginCommand(id)).join(' && ')}\n` +
        'Note: the browser step needs a real terminal — stdin closed, ' +
        'opencode falls through to an API-key prompt instead.',
    )
    return EXIT_MISSING_PROVIDER
  }
  return 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'reports which providers work can be offloaded to, what they reach, and what it has cost',
  help: `Usage: node scripts/fleet/offload-providers.mts [flags]

  --require a,b   exit 2 unless every named provider is authenticated

\`opencode run\` is fully headless, which is how a subagent offloads work.
\`opencode auth login\` is NOT: with stdin closed it falls through to an
API-key prompt rather than opening a browser, so this reports a missing
provider with the command to run instead of trying to run it.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
