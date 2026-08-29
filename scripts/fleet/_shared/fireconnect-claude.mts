/**
 * @file The Claude Code seat's model, when FireConnect is what decides it.
 *   FIRECONNECT OWNS THIS ROUTE, SO THE FLEET DRIVES IT RATHER THAN REPLACING
 *   IT. Pointing Claude Code at Fireworks means an Anthropic-compatible gateway
 *   URL, an auth token, and a per-alias model mapping, all written into the
 *   client's settings - and `fireconnect claude off` restores the settings it
 *   replaced from its own backup. Hand-writing those keys would fight that
 *   backup and strand the operator with no way back, so every change here is a
 *   `fireconnect claude` invocation. THE NATIVE ALIASES ARE STILL SEATS.
 *   `opus`/`sonnet`/`haiku`/`fable` are what the seat runs when it is NOT
 *   routed, so the cycle list carries both: the aliases first, then the
 *   Fireworks models. Stepping from the last alias into the first Fireworks
 *   model is what turns routing on, and wrapping back is what turns it off.
 *   STATUS IS A SUBPROCESS, AND THAT IS WHY IT IS NOT ON THE RENDER PATH. The
 *   statusline names the model from Claude Code's own render payload and only
 *   builds a caret URL, which needs no state at all. This module runs on a
 *   CLICK, where one subprocess is affordable and a wrong answer is not.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

/**
 * The FireConnect binary. Resolved off PATH rather than pinned: its installer
 * puts a shim in the operator's own bin directory, and the fleet's setup step
 * is what put it there.
 */
export const FIRECONNECT_BIN = 'fireconnect'

/**
 * How long to wait on a FireConnect call before giving up.
 *
 * A click is waiting on it. Absent, hung, or slow all resolve the same way -
 * the seat reports itself unrouted and the caret does nothing - because a click
 * that silently blocks is worse than one that does not fire.
 */
export const FIRECONNECT_TIMEOUT_MS = 5000

export interface FireconnectClaudeStatus {
  /**
   * The model the seat runs now: a native alias when unrouted, a FireConnect
   * model id when routed.
   */
  readonly model: string | undefined
  /**
   * Whether Claude Code is currently pointed at Fireworks. `default` means the
   * client is talking to Anthropic.
   */
  readonly routed: boolean
}

function runFireconnect(args: readonly string[]): string | undefined {
  try {
    const result = spawnSync(FIRECONNECT_BIN, [...args], {
      encoding: 'utf8',
      timeout: FIRECONNECT_TIMEOUT_MS,
    })
    return result.status === 0 && typeof result.stdout === 'string'
      ? result.stdout
      : undefined
  } catch {
    // Not installed on this machine, which is the ordinary case for a member
    // that never ran the setup step.
    return undefined
  }
}

/**
 * Pull the seat's state out of a `fireconnect claude status --json` payload.
 *
 * Returns undefined for a shape this does not recognise, so a FireConnect
 * upgrade that changes the payload degrades to "unrouted" rather than to a
 * confident wrong answer.
 */
export function parseFireconnectStatus(
  payload: unknown,
): FireconnectClaudeStatus | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined
  }
  const record = payload as Record<string, unknown>
  const provider = record['provider']
  if (typeof provider !== 'string') {
    return undefined
  }
  const current = record['current']
  const main =
    typeof current === 'object' && current !== null
      ? (current as Record<string, unknown>)['main']
      : undefined
  return {
    model: typeof main === 'string' && main ? main : undefined,
    // Anything other than `default` is a gateway, so the seat is routed.
    routed: provider !== 'default',
  }
}

/**
 * What the Claude Code seat runs, and whether FireConnect is routing it.
 */
export function readFireconnectClaudeStatus():
  | FireconnectClaudeStatus
  | undefined {
  const out = runFireconnect(['claude', 'status', '--json'])
  if (out === undefined) {
    return undefined
  }
  try {
    return parseFireconnectStatus(JSON.parse(out))
  } catch {
    return undefined
  }
}

/**
 * The Fireworks models FireConnect can point the seat at, by short id.
 *
 * Short ids rather than the full `accounts/fireworks/...` path because that is
 * what `--model` takes and what its own listing leads with.
 */
export function parseFireconnectModels(payload: unknown): string[] | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined
  }
  const models = (payload as Record<string, unknown>)['models']
  if (!Array.isArray(models)) {
    return undefined
  }
  const ids: string[] = []
  for (const entry of models) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const shortId = (entry as Record<string, unknown>)['shortId']
    if (typeof shortId === 'string' && shortId.length > 0) {
      ids.push(shortId)
    }
  }
  return ids.length > 0 ? ids : undefined
}

/**
 * Every Fireworks model the seat can be pointed at, or undefined when
 * FireConnect cannot answer.
 */
export function listFireconnectModels(): string[] | undefined {
  const out = runFireconnect(['model', 'list', '--json'])
  if (out === undefined) {
    return undefined
  }
  try {
    return parseFireconnectModels(JSON.parse(out))
  } catch {
    return undefined
  }
}

/**
 * Route the seat through Fireworks on `model`. True when FireConnect accepted
 * it.
 *
 * `--non-interactive` because the caller is a click: the first-run model
 * onboarding wizard has no terminal to draw on here, and a subprocess waiting
 * for input would hang the handler rather than prompt anyone.
 */
export function routeClaudeThroughFireworks(model: string): boolean {
  return (
    runFireconnect(['claude', 'on', '--model', model, '--non-interactive']) !==
    undefined
  )
}

/**
 * Put the seat back on Anthropic, restoring the settings FireConnect replaced.
 */
export function restoreClaudeDefaultRoute(): boolean {
  return runFireconnect(['claude', 'off']) !== undefined
}
