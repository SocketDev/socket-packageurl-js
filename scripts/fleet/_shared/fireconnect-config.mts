/**
 * @file The Fireworks account id, read from FireConnect's own config.
 *   WHY NOT HARDCODE IT. This file cascades to every fleet repo, so an account
 *   id written here would be one organisation's identifier shipped to all of
 *   them - the same defect as writing a person's name into a shared type. The
 *   id belongs to whoever signed in, so it is read from where the sign-in
 *   recorded it.
 *   IT IS NOT A SECRET, AND THAT IS NOT THE POINT. An account id is fine to
 *   print; it is per-machine configuration with no other home. The credential
 *   beside it in the same file is NEVER read here - only the id is, by name.
 *   ABSENT IS ORDINARY. A machine with no FireConnect is the common case, so
 *   this resolves to undefined and the caller falls back to its own slot or to
 *   a local reading.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { FIRECONNECT_HOME } from '../paths.mts'

/**
 * FireConnect's config file.
 */
export function fireconnectConfigPath(home: string = FIRECONNECT_HOME): string {
  return path.join(home, 'config.json')
}

/**
 * The account id FireConnect signed in as, or undefined.
 *
 * Only `ssoAccountId` is read. The same file holds an `apiKey`, and reading a
 * field this does not need would put a credential in a code path that has no
 * business handling one.
 */
export function readFireconnectAccountId(
  target: string = fireconnectConfigPath(),
): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(target, 'utf8'))
  } catch {
    // No FireConnect, no read permission, or a config it rewrote. All of them
    // mean the caller uses its own slot instead.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  const id = (parsed as Record<string, unknown>)['ssoAccountId']
  return typeof id === 'string' && id.length > 0 ? id : undefined
}
