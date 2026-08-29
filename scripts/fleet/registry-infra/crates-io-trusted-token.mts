#!/usr/bin/env node
/*
 * @file Mint and revoke a crates.io trusted-publishing token, without a
 *   third-party action.
 *
 *   This replaces `rust-lang/crates-io-auth-action`. Same protocol, no
 *   third-party action in the publish path, and nothing to re-pin when upstream
 *   retags: that action's floating `v1` tag was deleted out from under our pin,
 *   which is exactly the class of surprise the fleet avoids by owning the code.
 *
 *   The exchange is three steps and no dependencies:
 *     1. Ask the runner for an OIDC JWT, proving which workflow is running.
 *        `ACTIONS_ID_TOKEN_REQUEST_URL` + `ACTIONS_ID_TOKEN_REQUEST_TOKEN` are
 *        only present when the job declares `id-token: write`.
 *     2. POST `{jwt}` to `<registry>/api/v1/trusted_publishing/tokens` and read
 *        back a short-lived token.
 *     3. DELETE the same endpoint with that token to revoke it.
 *
 *   REVOKE IS A WORKFLOW STEP, not an action `post` hook. A composite action
 *   cannot declare `post`, so the caller runs `--revoke` in an `if: always()`
 *   step. That is more honest than emulating a post hook: the revoke is visible
 *   in the workflow, and a reader can see it runs even when publishing failed.
 *
 *   Usage:
 *     node scripts/fleet/registry-infra/crates-io-trusted-token.mts [--url <registry>]
 *     node scripts/fleet/registry-infra/crates-io-trusted-token.mts --revoke [--url <registry>]
 *
 *   Minting writes `token=<value>` to GITHUB_OUTPUT and masks it in the log.
 *   Revoking reads the token from `CRATES_IO_TOKEN`.
 */

import { appendFileSync } from 'node:fs'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import {
  httpJson,
  httpRequest,
  HttpResponseError,
} from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * The registry every fleet crate publishes to unless told otherwise.
 */
export const DEFAULT_REGISTRY_URL = 'https://crates.io'

/**
 * Normalize a registry URL: no trailing slash, so the endpoint below never
 * builds a doubled `//api`.
 */
export function normalizeRegistryUrl(url: string | undefined): string {
  const raw = (url ?? '').trim() || DEFAULT_REGISTRY_URL
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

/**
 * The OIDC audience for a registry: the URL with its scheme removed. crates.io
 * matches the audience against the host, so `https://crates.io` must ask for
 * `crates.io` and nothing else — a JWT minted for the wrong audience is
 * rejected, which reads as an auth failure rather than a config mistake.
 */
export function audienceFor(registryUrl: string): string {
  return normalizeRegistryUrl(registryUrl).replace(/^https?:\/\//u, '')
}

/**
 * The trusted-publishing token endpoint. Both minting and revoking use it.
 */
export function tokensEndpoint(registryUrl: string): string {
  return `${normalizeRegistryUrl(registryUrl)}/api/v1/trusted_publishing/tokens`
}

/**
 * The useful line out of a crates.io failure. Its error bodies are
 * `{"errors":[{"detail":"…"}]}`, so prefer that detail, then the raw body, then
 * the status — a failure always says something actionable even when the shape
 * changes.
 */
export function errorDetail(thrown: unknown): string {
  if (!(thrown instanceof HttpResponseError)) {
    return errorMessage(thrown)
  }
  const { status } = thrown.response
  let body = ''
  try {
    body = thrown.response.text()
  } catch {
    // A body that cannot be decoded leaves the status as the only signal.
  }
  try {
    const parsed = JSON.parse(body) as {
      errors?: Array<{ detail?: unknown | undefined }> | undefined
    }
    const details = (parsed.errors ?? [])
      .map(entry => entry?.detail)
      .filter((detail): detail is string => typeof detail === 'string')
    if (details.length > 0) {
      return details.join('; ')
    }
  } catch {
    // Not JSON - fall through to the raw body.
  }
  return body.trim() || `HTTP ${status}`
}

/**
 * The token in a parsed mint response, or undefined when it carries none. A
 * 2xx with no token is still a failure: publishing with an empty token fails
 * later and further from the cause.
 */
export function parseMintedToken(payload: unknown): string | undefined {
  const token = (payload as { token?: unknown | undefined } | undefined)?.token
  return typeof token === 'string' && token ? token : undefined
}

/**
 * Ask the runner for an OIDC JWT for `audience`. The two request variables
 * exist only when the job declares `id-token: write`, so their absence is a
 * workflow-permissions mistake and says so.
 */
export async function requestIdToken(audience: string): Promise<string> {
  const url = process.env['ACTIONS_ID_TOKEN_REQUEST_URL']
  const requestToken = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
  if (!url || !requestToken) {
    throw new Error(
      'No OIDC token request context. Set `permissions: id-token: write` on the job that mints the crates.io token.',
    )
  }
  let payload: unknown
  try {
    payload = await httpJson<unknown>(
      `${url}&audience=${encodeURIComponent(audience)}`,
      { headers: { authorization: `Bearer ${requestToken}` } },
    )
  } catch (e) {
    throw new Error(
      `Could not get an OIDC token from the runner: ${errorDetail(e)}`,
    )
  }
  const value = (payload as { value?: unknown | undefined } | undefined)?.value
  if (typeof value !== 'string' || !value) {
    throw new Error('The runner returned an OIDC response with no token.')
  }
  return value
}

/**
 * Exchange an OIDC JWT for a short-lived crates.io token.
 */
export async function mintToken(
  registryUrl: string,
  jwt: string,
): Promise<string> {
  const endpoint = tokensEndpoint(registryUrl)
  let payload: unknown
  try {
    payload = await httpJson<unknown>(endpoint, {
      body: JSON.stringify({ jwt }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  } catch (e) {
    throw new Error(
      `${endpoint} refused the trusted-publishing exchange: ${errorDetail(e)}`,
    )
  }
  const token = parseMintedToken(payload)
  if (!token) {
    throw new Error(
      `${endpoint} returned no token. Confirm this repo is registered as a trusted publisher for the crate.`,
    )
  }
  return token
}

/**
 * Revoke a minted token. Best-effort by design: the token is short-lived, so a
 * failed revoke must not fail the workflow after a successful publish.
 */
export async function revokeToken(
  registryUrl: string,
  token: string,
): Promise<boolean> {
  try {
    await httpRequest(tokensEndpoint(registryUrl), {
      headers: { authorization: `Bearer ${token}` },
      method: 'DELETE',
    })
    return true
  } catch {
    return false
  }
}

function readFlag(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag)
  if (at !== -1 && argv[at + 1] !== undefined) {
    return argv[at + 1]
  }
  const prefix = `${flag}=`
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length)
    }
  }
  return undefined
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const registryUrl = normalizeRegistryUrl(readFlag(argv, '--url'))
  if (argv.includes('--revoke')) {
    const token = process.env['CRATES_IO_TOKEN']
    if (!token) {
      logger.log('crates-io-trusted-token: nothing to revoke.')
      return
    }
    logger.log(`crates-io-trusted-token: revoking at ${registryUrl}.`)
    if (!(await revokeToken(registryUrl, token))) {
      // Never fatal: the token expires on its own, and failing here would turn
      // a successful publish into a red run.
      logger.warn(
        'crates-io-trusted-token: revoke failed; the token expires on its own.',
      )
    }
    return
  }
  const audience = audienceFor(registryUrl)
  logger.log(`crates-io-trusted-token: minting for audience ${audience}.`)
  const token = await mintToken(registryUrl, await requestIdToken(audience))
  // Mask before anything else can echo it.
  process.stdout.write(`::add-mask::${token}\n`)
  const out = process.env['GITHUB_OUTPUT']
  if (out) {
    appendFileSync(out, `token=${token}\n`)
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'mints or revokes a crates.io trusted-publishing token',
  help: `Usage: node scripts/fleet/registry-infra/crates-io-trusted-token.mts [flags]

  --url <registry>   registry base URL (default https://crates.io)
  --revoke           revoke the token in CRATES_IO_TOKEN instead of minting`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
