#!/usr/bin/env node
/*
 * @file `setup:offload-providers` — provision the offload ladder's providers
 *   on a fresh machine. The model-fallback hook walks fireworks → synthetic →
 *   odai → the Anthropic floor, and each rung is skipped when it is not set
 *   up, so a bare machine slides to the floor. This script is what turns a
 *   bare machine into a laddered one. THREE KINDS OF WORK, THREE HANDLINGS.
 *   What installs without a person (the CLIs, both npm globals at pinned
 *   versions) it installs. What needs a BROWSER (fireconnect login) or a
 *   dashboard paste (the synthetic key) it does not fake: those print as
 *   exact commands in a numbered queue at the end, one line per thing only a
 *   human can clear. What only needs checking (a credential's existence in
 *   the keychain, the odai server answering) it checks read-only - no
 *   keychain prompt, no server started, no secret ever printed. `--check`
 *   reports without installing. Usage: `pnpm run` setup:offload-providers
 *   [--check].
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { CLAUDE_HOME } from '../paths.mts'
import { isMainModule } from '../process/is-main-module.mts'
import {
  odaiServerAnswers,
  odaiServerUrl,
  resolveOdaiBin,
} from '../ai/odai.mts'
import { storeCredentialCommand } from '../ai/provider-credentials.mts'
import { runMain } from '../process/run-main.mts'

import type { ScriptMeta } from '../process/run-main.mts'

const logger = getDefaultLogger()

/**
 * The npm globals the ladder runs on, pinned. Both are plain libraries with
 * no postinstall - a global add is the whole install, and the pin keeps two
 * machines on the same code.
 */
export const CLI_PINS: Readonly<Record<string, string>> = {
  odai: '@socketsecurity/odai@0.2.1',
  opencode: 'opencode-ai@1.18.16',
}

export interface ProviderReadiness {
  readonly detail: string
  readonly name: string
  readonly ready: boolean
}

export interface MachineState {
  readonly codexServerUp: boolean
  readonly fireworksKey: boolean
  readonly odaiBin: boolean
  readonly odaiServerUp: boolean
  readonly opencodeBin: boolean
  readonly syntheticKey: boolean
}

/**
 * The interactive queue for one machine state: the exact commands, in
 * clearing order, for the steps no script can do - a browser auth, a
 * dashboard paste, a server the operator chooses to run. Empty when every
 * rung is already set up.
 */
export function interactiveQueue(state: MachineState): string[] {
  const out: string[] = []
  if (!state.fireworksKey) {
    out.push(
      'fireworks: pnpm run setup:fireconnect && fireconnect login  (browser auth; populates the fireworks-api-key slot)',
    )
  }
  if (!state.syntheticKey) {
    out.push(
      'synthetic: copy the API key from https://synthetic.new/billing, then:  SYNTHETIC_API_KEY=<paste> ' +
        storeCredentialCommand('syntheticApiKey'),
    )
  }
  if (!state.opencodeBin) {
    out.push(`opencode: pnpm add -g ${CLI_PINS['opencode']}`)
  }
  if (!state.odaiBin) {
    out.push(`odai: pnpm add -g ${CLI_PINS['odai']}`)
  }
  if (state.odaiBin && !state.odaiServerUp) {
    out.push(
      'odai backend: start llama-server on 127.0.0.1:8080 with a model loaded (odai answers 69 - clean skip - until one answers)',
    )
  }
  return out
}

/**
 * The readiness table for one machine state, in ladder order.
 */
export function readinessTable(state: MachineState): ProviderReadiness[] {
  return [
    {
      detail: state.fireworksKey
        ? 'fireworks-api-key slot present'
        : 'no fireworks credential in env or keychain',
      name: 'fireworks',
      ready: state.fireworksKey,
    },
    {
      detail: state.syntheticKey
        ? 'synthetic-api-key slot present'
        : 'no synthetic credential in env or keychain',
      name: 'synthetic',
      ready: state.syntheticKey,
    },
    {
      detail: state.codexServerUp
        ? 'codex CLI present (uses its own sign-in)'
        : 'codex CLI absent (optional: the codex seat needs no fleet credential)',
      name: 'codex',
      ready: true,
    },
    {
      detail: state.odaiServerUp
        ? 'odai bin + llama-server answering'
        : state.odaiBin
          ? 'odai bin present, no llama-server answering on 127.0.0.1:8080'
          : 'odai bin absent',
      name: 'odai',
      ready: state.odaiBin && state.odaiServerUp,
    },
  ]
}

/**
 * Whether a keychain slot EXISTS, without reading its value: a
 * find-generic-password with no -g never displays the secret and never
 * prompts for one. Exit 0 means present; anything else means absent.
 */
async function keychainSlotExists(account: string): Promise<boolean> {
  const result = await spawn(
    'security',
    ['find-generic-password', '-s', 'socket-fleet-offload', '-a', account],
    { stdioString: true },
  ).catch(() => undefined)
  return result !== undefined && result.code === 0
}

/**
 * Whether the settings file's custom headers carry a Fireworks key. The
 * settings env is a THIRD home for the credential after env and keychain -
 * it is how this machine's Claude Code routes to Fireworks directly, and a
 * prereq that missed it would send the operator to log in again over a key
 * they already have.
 */
function settingsHeadersCarryFireworksKey(home: string = CLAUDE_HOME): boolean {
  try {
    const settings = JSON.parse(
      readFileSync(path.join(home, 'settings.json'), 'utf8'),
    ) as { env?: Record<string, unknown> | undefined }
    const headers = settings.env?.['ANTHROPIC_CUSTOM_HEADERS']
    return (
      typeof headers === 'string' && headers.includes('X-Fireworks-Api-Key:')
    )
  } catch {
    return false
  }
}

function binExists(name: string): boolean {
  return typeof whichSync(name) === 'string'
}

/**
 * Read the machine's current state. Every check is read-only.
 */
export async function readMachineState(): Promise<MachineState> {
  const {
    0: fireworksKey,
    1: syntheticKey,
    2: codexServerUp,
    3: serverUp,
  } = await Promise.all([
    process.env['FIREWORKS_API_KEY'] !== undefined ||
    settingsHeadersCarryFireworksKey()
      ? Promise.resolve(true)
      : keychainSlotExists('fireworks-api-key'),
    process.env['SYNTHETIC_API_KEY'] !== undefined
      ? Promise.resolve(true)
      : keychainSlotExists('synthetic-api-key'),
    Promise.resolve(binExists('codex')),
    odaiServerAnswers(odaiServerUrl()),
  ])
  return {
    codexServerUp,
    fireworksKey,
    odaiBin: resolveOdaiBin() !== undefined,
    odaiServerUp: serverUp,
    opencodeBin: binExists('opencode'),
    syntheticKey,
  }
}

async function installCli(spec: string): Promise<boolean> {
  // pnpm from the repo root, never npx/dlx: the add is global but the binary
  // resolution is pnpm's own, and the version is the pin above, not "latest".
  const result = await spawn('pnpm', ['add', '-g', spec], {
    stdioString: true,
  }).catch(() => undefined)
  return result !== undefined && result.code === 0
}

export async function main(): Promise<number> {
  const checkOnly = process.argv.includes('--check')
  let state = await readMachineState()
  for (const line of readinessTable(state)) {
    logger.log(
      `  ${line.ready ? 'READY  ' : 'MISSING'} ${line.name.padEnd(10)} ${line.detail}`,
    )
  }
  if (!checkOnly) {
    // Install what installs without a person, then re-read so the queue
    // prints only what is genuinely left.
    for (const [name, spec] of Object.entries(CLI_PINS)) {
      const present = name === 'odai' ? state.odaiBin : state.opencodeBin
      if (!present) {
        logger.log(`installing ${spec}…`)
        const ok = await installCli(spec)
        logger[ok ? 'success' : 'warn'](
          ok
            ? `${name} installed`
            : `${name} install failed - the queue names the manual step`,
        )
      }
    }
    state = await readMachineState()
  }
  const remaining = interactiveQueue(state)
  if (remaining.length === 0) {
    logger.success(
      'setup:offload-providers — every ladder rung is set up; the fallback hook will never need the floor.',
    )
    return 0
  }
  logger.log('')
  logger.log('Steps only a human can clear, in order:')
  for (let i = 0, { length } = remaining; i < length; i += 1) {
    logger.log(`  ${i + 1}. ${remaining[i]!}`)
  }
  logger.log('')
  logger.log(
    'A keychain write may ask for the login password once; a browser step opens in your default browser. Nothing here was written or started.',
  )
  return 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'provision the offload ladder providers: installs the CLIs, checks credentials read-only, and prints the interactive steps',
  help: `Usage: pnpm run setup:offload-providers [--check]

Installs opencode and odai at their pinned npm versions, checks the fireworks
and synthetic credential slots (existence only - never reads a secret), and
probes the odai llama-server. Everything a script cannot do - browser login,
dashboard key paste, choosing to run a server - prints as an exact numbered
command at the end. --check reports without installing.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
