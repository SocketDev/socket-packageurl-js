#!/usr/bin/env node
// Claude Code SessionStart hook (machine-wide: global) — model tier
// availability fallback.
//
// The tier env vars in ~/.claude/settings.json (ANTHROPIC_DEFAULT_*_MODEL,
// CLAUDE_CODE_SUBAGENT_MODEL) point each Claude Code model tier at one model
// on one provider. An alias that stops serving fails its whole tier CLOSED -
// a down classifier tier blocks every classified action in every session
// (measured: glm-fast-latest flapping took every Edit/Write/Bash-mutation
// down for hours). This hook is the poller: at session start it probes the
// tier's rung and, when it does not serve, walks a RANKED LADDER that
// criss-crosses providers to the next best model that does:
//
//   fireworks (direct, Anthropic-compatible)
//   → synthetic (through the ai-balancer, OpenAI-shaped upstream)
//   → odai (on-device llama-server through the ai-balancer, keyless)
//   → anthropic (native subscription auth: the overrides come OFF, the floor)
//
// A rung is SKIPPED when it is not set up on this machine - no credential, no
// odai binary, no llama-server - so a bare machine slides straight to the
// Anthropic floor, which is the one provider a Claude Code session always
// has. When the ideal serves again, the next session's probe walks back up
// the ladder and restores it: the fallback is never a hand-edit someone has
// to remember to revert.
//
// WHAT IT TOUCHES. Only the model-tier env keys plus ANTHROPIC_BASE_URL,
// ANTHROPIC_CUSTOM_HEADERS, and AI_BALANCER_PRIMARY_PROVIDER in
// ~/.claude/settings.json, rewritten atomically (scratch + rename) only when
// a value actually changes; the starting session gets the same values through
// CLAUDE_ENV_FILE exports, so the fallback applies NOW, not next launch. A
// tier whose current value the ladder does not know is an operator override
// and is left alone, as is a rung that cannot authenticate - pointing at an
// unprobed model would be a guess wearing a gauge.
//
// Probes retry with exponential backoff + jitter (lib-stable pRetry): one
// 503 flap must not read as a dead provider, and a restored provider must
// not be hammered on the way back.

import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { pRetry } from '@socketsecurity/lib-stable/promises/retry'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { readSecret } from '@socketsecurity/lib-stable/secrets/keychain'

import { isAiBalancerEnabled } from '../_shared/balancer/detect.mts'
import { getBuiltin } from '../_shared/builtin-module.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'

import pricingJson from '../../../../scripts/fleet/constants/model-pricing.json' with { type: 'json' }

import type * as NodeHttp from 'node:http'
import type * as NodeHttps from 'node:https'

/**
 * The providers a ladder rung can point a tier at. Anthropic is the floor,
 * reached by REMOVING overrides rather than adding one, and it needs no probe
 * because the session's own auth is the credential. `openai` is reached via
 * the codex-shim loopback server (:8081) — the same OpenAI provider, accessed
 * through a CLI shim rather than a direct API key. `odai` is the on-device
 * llama-server. `fireworks` and `synthetic` are the remote HTTP offload
 * providers, reached with an API key.
 *
 * The access method (CLI shim vs API key vs native) is the classification:
 * `needs: 'credential'` = API-key provider, `needs: 'server'` = CLI-shim or
 * local-server provider (probe the shim's /health), `needs: 'none'` = the
 * anthropic floor (direct, no probe).
 */
export type RungProvider =
  | 'anthropic'
  | 'fireworks'
  | 'odai'
  | 'openai'
  | 'synthetic'

/**
 * One ladder rung: how the tier reaches a model when this rung is the answer.
 * `model` is the tier env value. For balancer rungs (synthetic, odai) the
 * value is the Anthropic family ALIAS of the tier, because the balancer maps
 * family → provider model through MODEL_EQUIVALENCE; for direct rungs it is
 * the provider's own model id.
 */
export interface LadderRung {
  readonly display: RungDisplay
  /**
   * What the setup check needs before this rung may serve. `credential`
   * needs the provider's key in the settings env or process env; `server`
   * needs odai's loopback llama-server answering; `none` is always set up.
   */
  readonly needs: 'credential' | 'none' | 'server'
  readonly model: string
  readonly provider: RungProvider
}

/**
 * The display strings a rung writes to the tier's _NAME / _DESCRIPTION
 * companions, so a fallback never mislabels the model it switched to.
 */
export interface RungDisplay {
  readonly description: string
  readonly name: string
}

export interface TierSpec {
  readonly descEnv?: string | undefined
  readonly env: string
  readonly nameEnv?: string | undefined
  readonly rungs: readonly LadderRung[]
}

const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference'
const BALANCER_BASE_URL = 'http://localhost:7778'
const BALANCER_PORT = 7778
const CODEX_SHIM_PORT = 8081

const ANTHROPIC_MODEL_FAMILY: Readonly<Record<string, string>> = {
  ANTHROPIC_DEFAULT_FABLE_MODEL: 'fable',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet',
  CLAUDE_CODE_SUBAGENT_MODEL: 'haiku',
}

/**
 * The display strings for each direct-Fireworks model value a rung can
 * assign. The strings are the operator's own, lifted from their settings
 * file, so a fallback never mislabels the model it switched to.
 */
const DISPLAYS: Readonly<Record<string, RungDisplay>> = {
  'deepseek-v4-flash': {
    description:
      'Fireworks serverless (DeepSeek-V4-Flash): $0.14 in / $0.28 out per Mtok ($0.028 cached in).',
    name: 'DeepSeek V4 Flash',
  },
  'glm-fast-latest[1m]': {
    description:
      'Fireworks serverless (GLM 5.2 Fast (Latest)): $2.1 in / $6.6 out per Mtok ($0.21 cached in). Fast tier.',
    name: 'GLM 5.2 Fast (Latest)',
  },
  'kimi-fast-latest[1m]': {
    description:
      'Fireworks serverless (Kimi K3 Fast (Latest)): $4.5 in / $22.5 out per Mtok ($0.45 cached in). Fast tier.',
    name: 'Kimi K3 Fast (Latest)',
  },
}

function balancerDisplay(family: string, provider: string): RungDisplay {
  return {
    description: `Routed to ${provider} through the local ai-balancer while the Fireworks ideal is down; restores automatically when it serves again.`,
    name: `${family} via ${provider}`,
  }
}

function floorDisplay(family: string): RungDisplay {
  return {
    description:
      'Anthropic native subscription auth: the offload overrides are removed because every offload rung is down or not set up.',
    name: `${family} (Anthropic direct)`,
  }
}

/**
 * The model value one tier gets on one rung, with its display strings.
 */
function rungModel(
  tierEnv: string,
  provider: RungProvider,
  fireworksModel?: string | undefined,
): { display: RungDisplay; model: string } {
  const family = ANTHROPIC_MODEL_FAMILY[tierEnv] ?? 'sonnet'
  if (provider === 'fireworks' && fireworksModel !== undefined) {
    return {
      display: DISPLAYS[fireworksModel] ?? floorDisplay(family),
      model: fireworksModel,
    }
  }
  if (provider === 'synthetic') {
    return { display: balancerDisplay(family, 'Synthetic'), model: family }
  }
  if (provider === 'openai') {
    return {
      display: balancerDisplay(family, 'OpenAI (codex-shim)'),
      model: family,
    }
  }
  if (provider === 'odai') {
    return {
      display: balancerDisplay(family, 'odai (on-device)'),
      model: family,
    }
  }
  return { display: floorDisplay(family), model: family }
}

/**
 * The Anthropic-family aliases the pricing data has suspended, as the short
 * token a tier env value carries (`fable` for `claude-fable-5`). Read from the
 * same `services.*.models.*.suspended` flag model-policy-guard blocks on, so a
 * model the fleet took out of service is never the floor a ladder settles on.
 * Derived rather than hardcoded: clearing the flag clears the suspension with
 * no edit here.
 */
export function suspendedFamilyAliases(): ReadonlySet<string> {
  const out = new Set<string>()
  const services = pricingJson['services']
  if (typeof services !== 'object' || services === null) {
    return out
  }
  const serviceValues = Object.values(services)
  for (let i = 0, { length } = serviceValues; i < length; i += 1) {
    const service = serviceValues[i]
    if (typeof service !== 'object' || service === null) {
      continue
    }
    const models = (service as Record<string, unknown>)['models']
    if (typeof models !== 'object' || models === null) {
      continue
    }
    const modelEntries = Object.entries(models as Record<string, unknown>)
    for (
      let j = 0, { length: entryCount } = modelEntries;
      j < entryCount;
      j += 1
    ) {
      const { 0: id, 1: entry } = modelEntries[j]!
      if (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as Record<string, unknown>)['suspended'] === true &&
        id.startsWith('claude-')
      ) {
        // `claude-fable-5` → `fable`: the middle token is the family alias the
        // tier env carries. A non-conforming id is not a family the ladders
        // know, so it is left for the guard to name.
        const parts = id.split('-')
        if (parts.length >= 3) {
          out.add(parts[1]!)
        }
      }
    }
  }
  return out
}

/**
 * The managed tiers and each one's ladder, ranked best-first and
 * criss-crossing providers: the Fireworks ideals, then the next best model
 * on a DIFFERENT provider, then the on-device seat, then the floor.
 */
export function tiersFor(): TierSpec[] {
  function ladder(
    env: string,
    fireworksRank: readonly string[],
    nameEnv?: string | undefined,
    descEnv?: string | undefined,
  ): TierSpec {
    const rungs: LadderRung[] = []
    for (let i = 0, { length } = fireworksRank; i < length; i += 1) {
      rungs.push({
        ...rungModel(env, 'fireworks', fireworksRank[i]!),
        needs: 'credential',
        provider: 'fireworks',
      })
    }
    rungs.push(
      {
        ...rungModel(env, 'synthetic'),
        needs: 'credential',
        provider: 'synthetic',
      },
      {
        ...rungModel(env, 'openai'),
        needs: 'server',
        provider: 'openai',
      },
      { ...rungModel(env, 'odai'), needs: 'server', provider: 'odai' },
      { ...rungModel(env, 'anthropic'), needs: 'none', provider: 'anthropic' },
    )
    return { descEnv, env, nameEnv, rungs }
  }
  return [
    ladder(
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      ['glm-fast-latest[1m]', 'kimi-fast-latest[1m]'],
      'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
      'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
    ),
    ladder(
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      ['glm-fast-latest[1m]', 'kimi-fast-latest[1m]'],
      'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
      'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
    ),
    ladder(
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      ['deepseek-v4-flash', 'kimi-fast-latest[1m]', 'glm-fast-latest[1m]'],
      'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
    ),
    ladder(
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
      ['kimi-fast-latest[1m]', 'glm-fast-latest[1m]'],
      'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
      'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION',
    ),
    // The subagent tier must never strand on the floor while another tier
    // sits on Fireworks: one ANTHROPIC_BASE_URL serves the whole process, so
    // a native-Anthropic alias 404s under a Fireworks URL. kimi-fast is the
    // rung that keeps the tier on the same provider as its siblings.
    ladder('CLAUDE_CODE_SUBAGENT_MODEL', [
      'deepseek-v4-flash',
      'kimi-fast-latest[1m]',
    ]),
  ]
}

/**
 * Every env value the ladders can assign - a tier sitting on one of these is
 * managed; anything else is an operator override and the hook leaves it be.
 */
export function managedModelValues(tiers: readonly TierSpec[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0, { length } = tiers; i < length; i += 1) {
    const rungs = tiers[i]!.rungs
    for (let j = 0, { length: count } = rungs; j < count; j += 1) {
      out.add(rungs[j]!.model)
    }
  }
  return out
}

export interface EnvState {
  readonly baseUrl: string | undefined
  readonly customHeaders: string | undefined
  readonly primaryProvider: string | undefined
}

/**
 * The provider the current env state points at, inferred from its routing
 * keys rather than stored anywhere: fireworks direct, the balancer (and
 * which provider the balancer primaries), or native Anthropic when no
 * override is set.
 */
export function currentProvider(state: EnvState): RungProvider {
  if (state.baseUrl === undefined) {
    return 'anthropic'
  }
  let host: string
  let port: number
  try {
    const u = new URL(state.baseUrl)
    host = u.hostname
    port = u.port === '' ? (u.protocol === 'https:' ? 443 : 80) : Number(u.port)
  } catch {
    return 'anthropic'
  }
  if (host === 'api.fireworks.ai') {
    return 'fireworks'
  }
  if (host === '127.0.0.1' || host === 'localhost') {
    if (port === BALANCER_PORT) {
      if (state.primaryProvider === 'synthetic') {
        return 'synthetic'
      }
      if (state.primaryProvider === 'odai') {
        return 'odai'
      }
      if (state.primaryProvider === 'openai') {
        return 'openai'
      }
    }
  }
  return 'anthropic'
}

/**
 * The Fireworks API key, from the settings' custom headers first (the
 * established home for it on this machine) or the env override. Never logged.
 */
export function fireworksKeyOf(
  customHeaders: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env['FIREWORKS_API_KEY']
  if (fromEnv) {
    return fromEnv
  }
  if (typeof customHeaders !== 'string') {
    return undefined
  }
  const lines = customHeaders.replace(/\r\n/g, '\n').split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('X-Fireworks-Api-Key:')) {
      const key = line.slice('X-Fireworks-Api-Key:'.length).trim()
      return key.length > 0 ? key : undefined
    }
  }
  return undefined
}

/**
 * The credential a credential-needing rung uses, or undefined when the rung
 * is not set up. Env first, then the keychain: the synthetic key is stored
 * durably in the OS keychain (service `socket-fleet-offload`, account
 * `synthetic-api-key`) by the operator, and a read from the default keychain
 * does not prompt on macOS when the keychain is unlocked, so the SessionStart
 * probe resolves without blocking. A denied or locked keychain read returns
 * undefined and the rung is skipped, same as an absent env var.
 */
export async function rungCredential(
  provider: RungProvider,
  customHeaders: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (provider === 'fireworks') {
    return fireworksKeyOf(customHeaders, env)
  }
  if (provider === 'synthetic') {
    const fromEnv = env['SYNTHETIC_API_KEY']
    if (fromEnv) {
      return fromEnv
    }
    try {
      return await readSecret({
        account: 'synthetic-api-key',
        service: 'socket-fleet-offload',
      })
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * The odai loopback server URL: ODAI_LLAMA_URL when set, else the CLI's
 * default. Loopback only - a non-loopback value reads as not-set-up, the
 * same posture the odai backend itself takes.
 */
export function odaiServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const candidate = env['ODAI_LLAMA_URL'] ?? 'http://127.0.0.1:8080'
  return /^https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)/.test(candidate)
    ? candidate
    : 'http://127.0.0.1:8080'
}

export type ProbeVerdict = 'down' | 'setup-missing' | 'up'

export interface ProbeConfig {
  readonly customHeaders: string | undefined
  readonly env: NodeJS.ProcessEnv
  /**
   * Injected for tests: one HTTP probe of a remote rung. Production probes
   * POST a 1-token completion; tests answer from a table.
   */
  readonly probeRemote?:
    | ((rung: LadderRung, credential: string) => Promise<boolean>)
    | undefined
  readonly probeServer?: ((url: string) => Promise<boolean>) | undefined
}

/**
 * Whether odai's side of the odai rung is set up: the CLI resolves AND its
 * loopback server answers. A machine with the bin but no running server is
 * not started by this hook - launching a model server is seconds of session
 * start, so the rung simply skips.
 */
async function odaiIsServing(config: ProbeConfig): Promise<boolean> {
  const explicit = config.env['ODAI_BIN']
  const found = explicit ?? whichSync('odai')
  if (typeof found !== 'string' || !existsSync(found)) {
    return false
  }
  const probe = config.probeServer ?? defaultProbeServer
  return probe(odaiServerUrl(config.env))
}

async function defaultProbeServer(url: string): Promise<boolean> {
  const http = getBuiltin<typeof NodeHttp>('node:http')
  return new Promise(resolve => {
    const req = http.get(`${url}/v1/models`, { timeout: 750 }, res => {
      res.resume()
      const status = res.statusCode ?? 0
      resolve(status >= 200 && status < 300)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * One HTTP probe of a remote rung, with pRetry's exponential backoff + jitter
 * around it: a single 503 flap must not read as a dead provider. Two retries
 * at a ~1s base keeps the worst case inside the SessionStart budget.
 */
async function probeRemoteRung(
  rung: LadderRung,
  credential: string,
  config: ProbeConfig,
): Promise<boolean> {
  const once = config.probeRemote ?? defaultProbeRemote
  const verdict = await pRetry(
    async () => {
      const up = await once(rung, credential)
      if (!up) {
        throw new Error('not serving')
      }
      return true
    },
    { backoffFactor: 2, baseDelayMs: 1000, jitter: true, retries: 2 },
  ).catch(() => false)
  return verdict === true
}

async function defaultProbeRemote(
  rung: LadderRung,
  credential: string,
): Promise<boolean> {
  const https = getBuiltin<typeof NodeHttps>('node:https')
  const isSynthetic = rung.provider === 'synthetic'
  const host = isSynthetic ? 'api.synthetic.new' : 'api.fireworks.ai'
  const requestPath = isSynthetic
    ? '/v1/chat/completions'
    : '/inference/v1/messages'
  const probeModel = isSynthetic
    ? 'hf:moonshotai/Kimi-K3'
    : rung.model.replace(/\[[^\]]*\]$/, '')
  const body = JSON.stringify({
    max_tokens: 1,
    messages: [{ content: 'ping', role: 'user' }],
    model: probeModel,
  })
  return new Promise(resolve => {
    const req = https.request(
      {
        headers: {
          ...(isSynthetic
            ? { authorization: `Bearer ${credential}` }
            : {
                'anthropic-version': '2023-06-01',
                'x-fireworks-api-key': credential,
              }),
          'content-length': String(Buffer.byteLength(body)),
          'content-type': 'application/json',
        },
        hostname: host,
        method: 'POST',
        path: requestPath,
        port: 443,
        timeout: 5000,
      },
      res => {
        res.resume()
        const status = res.statusCode ?? 0
        // 401/403 is a CREDENTIAL failure, which every rung on this provider
        // shares - it reads down like any other and the ladder walks past.
        resolve(status >= 200 && status < 300)
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end(body)
  })
}

/**
 * Probe one rung: setup check first, then the serving check. The floor rung
 * never probes - the session's own auth is its credential. A suspended
 * Anthropic floor answers 'down' without a probe, because the fleet's pricing
 * data already said it must not serve and no probe can change that.
 */
export async function probeRung(
  rung: LadderRung,
  config: ProbeConfig,
): Promise<ProbeVerdict> {
  if (rung.provider === 'anthropic') {
    return suspendedFamilyAliases().has(rung.model) ? 'down' : 'up'
  }
  if (rung.provider === 'odai') {
    return (await odaiIsServing(config)) ? 'up' : 'setup-missing'
  }
  if (rung.provider === 'openai') {
    const codexBin = whichSync('codex')
    if (typeof codexBin !== 'string' || !existsSync(codexBin)) {
      return 'setup-missing'
    }
    const probe = config.probeServer ?? defaultProbeServer
    return (await probe(`http://127.0.0.1:${CODEX_SHIM_PORT}/health`))
      ? 'up'
      : 'setup-missing'
  }
  const credential = await rungCredential(
    rung.provider,
    config.customHeaders,
    config.env,
  )
  if (credential === undefined) {
    return 'setup-missing'
  }
  return (await probeRemoteRung(rung, credential, config)) ? 'up' : 'down'
}

/**
 * The first rung on the tier's ladder that can serve, walking rank order
 * across the providers. The floor always answers, so this always returns a
 * rung - a tier with everything above the floor down lands on the floor.
 * A suspended floor is the exception: it is not "down" like a flaky provider,
 * it is out of service fleet-wide, so settling on it would land the settings
 * on a model model-policy-guard then blocks. In that case the walk returns the
 * last NON-suspended rung and lets the next run restore the floor once the
 * flag clears.
 */
export async function chooseRung(
  tier: TierSpec,
  config: ProbeConfig,
): Promise<{ rung: LadderRung; verdicts: Record<string, ProbeVerdict> }> {
  const verdicts: Record<string, ProbeVerdict> = {}
  for (let i = 0, { length } = tier.rungs; i < length; i += 1) {
    const rung = tier.rungs[i]!
    const key = `${rung.provider}:${rung.model}`
    const verdict = await probeRung(rung, config)
    verdicts[key] = verdict
    if (verdict === 'up') {
      return { rung, verdicts }
    }
  }
  const suspended = suspendedFamilyAliases()
  const fallback =
    tier.rungs.findLast(
      rung => !(rung.provider === 'anthropic' && suspended.has(rung.model)),
    ) ?? tier.rungs[tier.rungs.length - 1]!
  return { rung: fallback, verdicts }
}

export interface RungEnvPatch {
  readonly baseUrl: string | undefined
  readonly customHeaders: string | undefined
  readonly model: string
  readonly primaryProvider: string | undefined
}

/**
 * The routing env one rung implies. Fireworks points direct with its key
 * header; balancer rungs point at the local balancer with the provider named
 * and NO credential header (the balancer injects the provider key from the
 * keychain server-side, so no secret lands in the settings file); the floor
 * removes every override and lets Claude Code's native auth drive.
 */
export function envPatchFor(
  rung: LadderRung,
  config: ProbeConfig,
): RungEnvPatch {
  if (rung.provider === 'fireworks') {
    const key = fireworksKeyOf(config.customHeaders, config.env)
    return {
      baseUrl: FIREWORKS_BASE_URL,
      customHeaders: `X-Fireworks-Api-Key: ${key ?? ''}\nX-Title: Claude Code\nHTTP-Referer: fireconnect/v0.9.2`,
      model: rung.model,
      primaryProvider: undefined,
    }
  }
  if (
    rung.provider === 'odai' ||
    rung.provider === 'openai' ||
    rung.provider === 'synthetic'
  ) {
    return {
      baseUrl: BALANCER_BASE_URL,
      customHeaders: undefined,
      model: rung.model,
      primaryProvider: rung.provider,
    }
  }
  return {
    baseUrl: undefined,
    customHeaders: undefined,
    model: rung.model,
    primaryProvider: undefined,
  }
}

export interface TierChange {
  readonly descEnv?: string | undefined
  readonly display: RungDisplay
  readonly env: string
  readonly from: string
  readonly nameEnv?: string | undefined
  readonly to: string
}

/**
 * The changes one run needs, as (a) the routing-env patch for the shared
 * routing keys and (b) the per-tier model assignments. The routing keys are
 * shared, so the chosen rung of the FIRST changed tier sets them; every
 * later tier on the same provider inherits.
 */
export function planChanges(
  env: Record<string, unknown>,
  tiers: readonly TierSpec[],
  chosen: ReadonlyMap<string, LadderRung>,
  config: ProbeConfig,
): { routing: RungEnvPatch | undefined; tierChanges: TierChange[] } {
  const managed = managedModelValues(tiers)
  const tierChanges: TierChange[] = []
  let routing: RungEnvPatch | undefined
  for (let i = 0, { length } = tiers; i < length; i += 1) {
    const tier = tiers[i]!
    const current = env[tier.env]
    if (typeof current !== 'string' || !managed.has(current)) {
      continue
    }
    const rung = chosen.get(tier.env)
    if (rung === undefined) {
      continue
    }
    const patch = envPatchFor(rung, config)
    routing ??= patch
    if (patch.model !== current) {
      tierChanges.push({
        descEnv: tier.descEnv,
        display: rung.display,
        env: tier.env,
        from: current,
        nameEnv: tier.nameEnv,
        to: patch.model,
      })
    }
  }
  // A change is owed when the routing itself moves even if every model value
  // already matches (restoring fireworks direct after a balancer stint keeps
  // family aliases, and the tier values alone would say "nothing to do").
  const state: EnvState = {
    baseUrl:
      typeof env['ANTHROPIC_BASE_URL'] === 'string'
        ? env['ANTHROPIC_BASE_URL']
        : undefined,
    customHeaders:
      typeof env['ANTHROPIC_CUSTOM_HEADERS'] === 'string'
        ? env['ANTHROPIC_CUSTOM_HEADERS']
        : undefined,
    primaryProvider:
      typeof env['AI_BALANCER_PRIMARY_PROVIDER'] === 'string'
        ? env['AI_BALANCER_PRIMARY_PROVIDER']
        : undefined,
  }
  if (routing !== undefined) {
    const providerNow = currentProvider(state)
    const providerNext = currentProvider({
      baseUrl: routing.baseUrl,
      customHeaders: routing.customHeaders,
      primaryProvider: routing.primaryProvider,
    })
    if (providerNow === providerNext && tierChanges.length === 0) {
      routing = undefined
    }
  }
  return { routing, tierChanges }
}

export function homeSettingsPath(home: string): string {
  return path.join(home, '.claude', 'settings.json')
}

/**
 * Apply the plan to a COPY of the env record. An undefined patch field
 * DELETES its key, which is how the floor removes the overrides. A defined
 * one sets it.
 */
export function applyPlan(
  env: Record<string, unknown>,
  routing: RungEnvPatch | undefined,
  tierChanges: readonly TierChange[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { __proto__: null, ...env }
  if (routing !== undefined) {
    if (routing.baseUrl === undefined) {
      delete next['ANTHROPIC_BASE_URL']
    } else {
      next['ANTHROPIC_BASE_URL'] = routing.baseUrl
    }
    if (routing.customHeaders === undefined) {
      delete next['ANTHROPIC_CUSTOM_HEADERS']
    } else {
      next['ANTHROPIC_CUSTOM_HEADERS'] = routing.customHeaders
    }
    if (routing.primaryProvider === undefined) {
      delete next['AI_BALANCER_PRIMARY_PROVIDER']
    } else {
      next['AI_BALANCER_PRIMARY_PROVIDER'] = routing.primaryProvider
    }
  }
  for (let i = 0, { length } = tierChanges; i < length; i += 1) {
    const change = tierChanges[i]!
    next[change.env] = change.to
    if (change.nameEnv !== undefined) {
      next[change.nameEnv] = change.display.name
    }
    if (change.descEnv !== undefined) {
      next[change.descEnv] = change.display.description
    }
  }
  return next
}

/**
 * Export the applied values to the STARTING session through CLAUDE_ENV_FILE,
 * so the fallback takes effect now rather than next launch. Unsets cannot be
 * expressed there (the file is append-only), so a move to the floor only
 * lands for the NEXT session - the settings write is what carries it.
 */
export function exportToSessionEnv(
  envFile: string,
  routing: RungEnvPatch | undefined,
  tierChanges: readonly TierChange[],
): void {
  const lines: string[] = []
  if (routing?.baseUrl !== undefined) {
    lines.push(`export ANTHROPIC_BASE_URL='${routing.baseUrl}'`)
  }
  if (routing?.customHeaders !== undefined) {
    lines.push(`export ANTHROPIC_CUSTOM_HEADERS='${routing.customHeaders}'`)
  }
  if (routing?.primaryProvider !== undefined) {
    lines.push(
      `export AI_BALANCER_PRIMARY_PROVIDER='${routing.primaryProvider}'`,
    )
  }
  for (let i = 0, { length } = tierChanges; i < length; i += 1) {
    const change = tierChanges[i]!
    lines.push(`export ${change.env}='${change.to}'`)
  }
  if (lines.length === 0) {
    return
  }
  try {
    appendFileSync(envFile, `${lines.join('\n')}\n`, 'utf8')
  } catch {
    // Best effort: the settings write already carries the change; a missing
    // or unwritable env file only costs the immediacy, not the fallback.
  }
}

export interface FallbackRun {
  readonly moves: string[]
  readonly notes: string[]
}

/**
 * One probe-plan-apply pass over the tier envs: the unit the SessionStart run
 * and the watch daemon share. Returns the moves and notes when the routing
 * changed, undefined when every tier already sits on a serving rung.
 *
 * `probeOverrides` injects `ProbeConfig`'s `probeRemote`/`probeServer` for
 * tests, the same injection point `chooseRung`/`probeRung` already take
 * directly - the real SessionStart and watch-daemon callers never pass it,
 * so probing stays on the real network there.
 */
/**
 * Remove every managed alias this hook owns from settings.json.
 *
 * The counterpart to the normal write path, for when routing is off. Only a
 * tier whose MODEL key currently holds a managed value is cleared, so an alias
 * the operator pointed somewhere else by hand is left alone. Returns undefined
 * when there was nothing to strip, which is the steady state once off.
 */
function stripManagedAliases(
  settingsPath: string,
  settings: Record<string, unknown>,
  env: Record<string, unknown>,
  tiers: readonly TierSpec[],
  managed: ReadonlySet<string>,
): FallbackRun | undefined {
  const removed: string[] = []
  for (let i = 0, { length } = tiers; i < length; i += 1) {
    const tier = tiers[i]!
    const current = env[tier.env]
    if (typeof current !== 'string' || !managed.has(current)) {
      continue
    }
    // The name and description keys ride along with the model key.
    const keys = [tier.env, tier.nameEnv, tier.descEnv].filter(
      (k): k is string => typeof k === 'string',
    )
    for (let k = 0, { length: count } = keys; k < count; k += 1) {
      const key = keys[k]!
      if (key in env) {
        delete env[key]
        removed.push(key)
      }
    }
  }
  if (removed.length === 0) {
    return undefined
  }
  settings['env'] = env
  const scratch = `${settingsPath}.${process.pid}.tmp`
  writeFileSync(scratch, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  renameSync(scratch, settingsPath)
  return {
    moves: [],
    notes: [
      `balancer routing off: removed ${String(removed.length)} managed alias key(s); restart the session for plain Anthropic defaults`,
    ],
  }
}

/**
 * The settings document on disk, or undefined when nothing readable is there
 * — no settings, no tiers to manage.
 */
function readFallbackSettings(
  settingsPath: string,
): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'))
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Walk each managed tier's ladder: the rung that answers, plus one note per
 * alias that did not. Availability is recorded per tier so a click mid-run
 * still reads a fresh verdict.
 */
async function chooseRungsForTiers(
  home: string,
  managedTiers: readonly TierSpec[],
  config: ProbeConfig,
): Promise<{ chosen: Map<string, LadderRung>; notes: string[] }> {
  const chosen = new Map<string, LadderRung>()
  const notes: string[] = []
  for (let i = 0, { length } = managedTiers; i < length; i += 1) {
    const tier = managedTiers[i]!
    const { rung, verdicts } = await chooseRung(tier, config)
    chosen.set(tier.env, rung)
    writeAvailability(home, verdicts)
    const verdictKeys = Object.keys(verdicts)
    for (let k = 0, { length: keyCount } = verdictKeys; k < keyCount; k += 1) {
      const key = verdictKeys[k]!
      if (verdicts[key] === 'down') {
        notes.push(`${key} not serving`)
      }
    }
  }
  return { chosen, notes }
}

/**
 * Land the plan on the settings file.
 *
 * The probes ran for seconds, so the document is re-read now rather than
 * writing back the copy from before the probe window, or any edit the file
 * gained in that window (a sibling top-level key, or another env entry) would
 * be lost wholesale. Only the `env` key gets mutated, onto whichever env
 * sub-object is now on disk.
 */
function writeFallbackPlan(
  settingsPath: string,
  settings: Record<string, unknown>,
  env: Record<string, unknown>,
  routing: RungEnvPatch | undefined,
  tierChanges: readonly TierChange[],
): void {
  let latest = settings
  const reread = readFallbackSettings(settingsPath)
  if (reread) {
    latest = reread
  }
  const latestEnvRaw = latest['env']
  const latestEnv: Record<string, unknown> = isPlainObject(latestEnvRaw)
    ? latestEnvRaw
    : env
  latest['env'] = applyPlan(latestEnv, routing, tierChanges)
  const scratch = `${settingsPath}.${process.pid}.tmp`
  writeFileSync(scratch, `${JSON.stringify(latest, null, 2)}\n`, 'utf8')
  renameSync(scratch, settingsPath)
  const envFile = process.env['CLAUDE_ENV_FILE']
  if (envFile) {
    exportToSessionEnv(envFile, routing, tierChanges)
  }
}

export async function runFallbackOnce(
  home: string,
  probeOverrides?: Pick<ProbeConfig, 'probeRemote' | 'probeServer'> | undefined,
): Promise<FallbackRun | undefined> {
  const settingsPath = homeSettingsPath(home)
  const settings = readFallbackSettings(settingsPath)
  if (!settings) {
    return undefined
  }
  const envRaw = settings['env']
  const env: Record<string, unknown> = isPlainObject(envRaw) ? envRaw : {}
  const config: ProbeConfig = {
    customHeaders:
      typeof env['ANTHROPIC_CUSTOM_HEADERS'] === 'string'
        ? env['ANTHROPIC_CUSTOM_HEADERS']
        : undefined,
    env: process.env,
    probeRemote: probeOverrides?.probeRemote,
    probeServer: probeOverrides?.probeServer,
  }
  const tiers = tiersFor()
  const managed = managedModelValues(tiers)
  const managedTiers = tiers.filter(tier => {
    const current = env[tier.env]
    return typeof current === 'string' && managed.has(current)
  })
  // Routing off means plain Anthropic defaults, so the aliases this hook owns
  // have to COME BACK OUT. Leaving them while the base-URL rewrite is skipped
  // is the exact broken half-state the flag exists to prevent: the aliases
  // name models only the offload providers serve, so every request 400s on a
  // model Anthropic has never heard of.
  if (!isAiBalancerEnabled()) {
    return stripManagedAliases(settingsPath, settings, env, tiers, managed)
  }
  if (managedTiers.length === 0) {
    return undefined
  }
  const { chosen, notes } = await chooseRungsForTiers(
    home,
    managedTiers,
    config,
  )
  const { routing, tierChanges } = planChanges(env, tiers, chosen, config)
  if (routing === undefined && tierChanges.length === 0) {
    return undefined
  }
  writeFallbackPlan(settingsPath, settings, env, routing, tierChanges)
  return {
    moves: tierChanges.map(c => `${c.env}: ${c.from} -> ${c.to}`),
    notes,
  }
}

/**
 * The background preflight record: per alias, whether it served at the last
 * probe and when that probe ran. The statusline's verifying indicator and the
 * caret handler's availability read both consume this - written on every
 * pass, so a click always knows what the ladder can serve right now.
 */
export function availabilityPath(
  options?: { home?: string | undefined } | undefined,
): string {
  const opts = { __proto__: null, ...options } as {
    home?: string | undefined
  }
  const home = opts.home ?? os.homedir()
  return path.join(home, '.cache', 'fleet', 'provider-availability.json')
}

export interface AvailabilityRecord {
  readonly probedAtMs: number
  readonly up: boolean
}

function writeAvailability(
  home: string,
  verdicts: Record<string, ProbeVerdict>,
): void {
  const file = availabilityPath({ home })
  let existing: Record<string, AvailabilityRecord> = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (isPlainObject(parsed)) {
      existing = parsed as Record<string, AvailabilityRecord>
    }
  } catch {
    // First write, or a malformed record replaced wholesale.
  }
  const next = { ...existing }
  const probedAtMs = Date.now()
  const verdictKeys = Object.keys(verdicts)
  for (let i = 0, { length } = verdictKeys; i < length; i += 1) {
    const key = verdictKeys[i]!
    next[key] = { probedAtMs, up: verdicts[key] === 'up' }
  }
  try {
    const { mkdirSync } = process.getBuiltinModule('node:fs')
    mkdirSync(path.dirname(file), { recursive: true })
    const scratch = `${file}.${process.pid}.tmp`
    writeFileSync(scratch, `${JSON.stringify(next)}\n`, 'utf8')
    renameSync(scratch, file)
  } catch {
    // The record is a convenience for readers, never worth a failed pass.
  }
}

export const hook = defineHook({
  check: async () => {
    const run = await runFallbackOnce(os.homedir())
    if (run === undefined) {
      return undefined
    }
    return notify(
      `model-fallback: ${run.moves.length > 0 ? run.moves.join('; ') : 'routing restored'}${run.notes.length > 0 ? ` (${run.notes.join(', ')})` : ''}. Settings updated; restores automatically when the ideal serves again.`,
    )
  },
  event: 'SessionStart',
  global: true,
  type: 'nudge',
})

/* c8 ignore start - entrypoint guard; exercised via subprocess */
void runHook(hook, import.meta.url)
/* c8 ignore stop */
