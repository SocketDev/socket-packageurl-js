/**
 * @file Where an offload provider's API credential comes from, and the one rule
 *   about handling it.
 *   ENVIRONMENT FIRST, THEN THE KEYCHAIN. The env var is the override for a
 *   one-off run; the keychain is the durable slot. A shell `export` does not
 *   survive into a fresh process, so a credential that must work on every
 *   statusline render has to live in the keychain - the env var alone would
 *   read as absent the moment the shell that set it exits.
 *   NEVER A FILE IN THE TREE, NEVER A LOG LINE. `.env` files are not a source
 *   here, and a credential's VALUE never appears in a return type meant for
 *   display, a thrown message, or a log. The only place it goes is the
 *   Authorization header of the request that needs it.
 *   ABSENT IS NOT AN ERROR. A machine that has not been set up is the ordinary
 *   case, and every caller has a fallback, so a missing credential resolves to
 *   undefined rather than throwing.
 */

import process from 'node:process'

import { readSecret } from '@socketsecurity/lib-stable/secrets/keychain'

/**
 * The keychain service every fleet provider credential is stored under. One
 * service with a slot per provider, so listing what the fleet holds is one
 * lookup rather than a guess at naming.
 */
export const CREDENTIAL_SERVICE = 'socket-fleet-offload'

/**
 * The keychain service + account where Claude Code stores its OAuth token.
 *
 * Owned here rather than by the shim that reads it: the slot registry below
 * names them, and the shim imports {@link readCredential} from this module, so
 * declaring them in the shim would close an import cycle.
 */
export const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'
export const CLAUDE_KEYCHAIN_ACCOUNT = 'claudeAiOauth'

export interface CredentialSlot {
  /**
   * The keychain account name inside {@link CREDENTIAL_SERVICE}.
   */
  readonly account: string
  /**
   * The environment variable that overrides the keychain.
   */
  readonly envVar: string
  /**
   * A slot another tool already owns, checked before the fleet's own.
   *
   * Some credentials are established by a tool's own browser login, which is a
   * better path than asking an operator to copy a secret by hand. Reading that
   * tool's slot means signing in THERE is enough, rather than the same key
   * having to exist in two places and drift.
   */
  readonly foreign?:
    | { readonly account: string; readonly service: string }
    | undefined
}

/**
 * Every credential the offload gauges can use, and where each lives.
 *
 * Fireworks needs two: a key AND the account id its billing path is scoped to.
 * The id is not a secret, but it is per-account configuration with no other
 * home, so it rides in the same slot mechanism rather than inventing a second.
 */
// The credential slot registry is a config document keyed by provider.
type CredentialSlots = Readonly<
  // oxlint-disable-next-line socket/prefer-refined-record -- config doc
  Record<string, CredentialSlot>
>

export const CREDENTIAL_SLOTS = {
  claudeOauthToken: {
    account: 'claude-oauth-token',
    envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    // Claude Code's own slot, established by its browser sign-in. Reading it
    // means signing in there is enough, so no operator copies a JWT by hand.
    foreign: {
      account: CLAUDE_KEYCHAIN_ACCOUNT,
      service: CLAUDE_KEYCHAIN_SERVICE,
    },
  },
  fireworksAccountId: {
    account: 'fireworks-account-id',
    envVar: 'FIREWORKS_ACCOUNT_ID',
  },
  fireworksApiKey: {
    account: 'fireworks-api-key',
    envVar: 'FIREWORKS_API_KEY',
    // FireConnect's own slot, established by `fireconnect login` (browser
    // auth). Reading it means signing in there is enough and no operator has
    // to copy a key by hand.
    foreign: { account: 'fireworks-api-key', service: 'FireworksAI' },
  },
  syntheticApiKey: {
    account: 'synthetic-api-key',
    envVar: 'SYNTHETIC_API_KEY',
  },
} as const satisfies CredentialSlots

export type CredentialName = keyof typeof CREDENTIAL_SLOTS

/**
 * Whether a test runner is driving.
 *
 * Vitest sets both; either alone is enough to be sure this is not a real run.
 */
export function isUnderTest(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['VITEST'] || env['VITEST_WORKER_ID'])
}

/**
 * Read a credential from the environment, then the keychain.
 *
 * Undefined when neither has it. The value is returned to the caller that makes
 * the request and must not be logged or embedded in a message from there.
 */
const inFlight = new Map<CredentialName, Promise<string | undefined>>()

export async function readCredential(
  name: CredentialName,
): Promise<string | undefined> {
  // Memoised for the life of the process. Every keychain read is an auth
  // prompt, and one run can want several credentials - the report asks each
  // provider for its model list - so without this a single command prompts
  // once per provider and once per retry.
  // Not memoised under a test runner: tests set and clear the environment
  // between cases, and a process-lifetime cache would serve one case's value to
  // the next. The prompt this cache exists to avoid cannot happen there anyway.
  if (isUnderTest()) {
    return resolveCredential(name)
  }
  const pending = inFlight.get(name)
  if (pending) {
    return pending
  }
  const promise = resolveCredential(name)
  inFlight.set(name, promise)
  return promise
}

async function resolveCredential(
  name: CredentialName,
): Promise<string | undefined> {
  const slot: CredentialSlot = CREDENTIAL_SLOTS[name]
  const fromEnv = process.env[slot.envVar]
  if (fromEnv) {
    return fromEnv
  }
  // A keychain read shows an OS auth prompt. Under a test runner that is a
  // hang followed by a failure on a CORRECTLY configured machine, which
  // measures the machine rather than the code - so tests see the environment
  // and nothing else, and assert against that.
  if (isUnderTest()) {
    return undefined
  }
  try {
    const own = await readSecret({
      account: slot.account,
      service: CREDENTIAL_SERVICE,
    })
    if (own) {
      return own
    }
    // The fleet's own slot is empty, so fall back to the tool that established
    // this credential. Checked SECOND: an operator who set the fleet slot
    // deliberately meant to override whatever a tool holds.
    return slot.foreign
      ? await readSecret({
          account: slot.foreign.account,
          service: slot.foreign.service,
        })
      : undefined
  } catch {
    // No keychain backend, a denied prompt, or an empty slot. All of them mean
    // the caller falls back to whatever it can measure locally.
    return undefined
  }
}

/**
 * The command that stores a credential durably, for a report to print.
 *
 * Built rather than written by hand so the service and account can never drift
 * from what {@link readCredential} looks up. The VALUE is deliberately left as a
 * shell reference: printing a literal secret into a copy-pasteable line is how
 * one ends up in a terminal scrollback and a screen recording.
 */
export function storeCredentialCommand(name: CredentialName): string {
  const slot = CREDENTIAL_SLOTS[name]
  return `security add-generic-password -s ${CREDENTIAL_SERVICE} -a ${slot.account} -w "$${slot.envVar}" -U`
}
