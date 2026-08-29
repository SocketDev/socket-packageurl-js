/*
 * @file The launch shape, as code. Every controlled browser the fleet opens
 *   follows ONE shape; this module is the single importable statement of it,
 *   folded out of playwright-law.mts (the law) and browser-session.mts (the
 *   reference implementation) so drivers, guards, checks, and MCP configs
 *   cite the same shape instead of re-deriving it. The clauses, and why each
 *   exists:
 *
 *   - `chromiumSandbox: true` is MANDATORY. Playwright defaults the Chromium
 *     sandbox OFF and injects a no-sandbox flag that current Chrome brands
 *     refuse outright — observed 2026-07-30 leaving the window open but the
 *     session unusable.
 *   - Exactly ONE ignored Playwright default: `--enable-automation` (sets the
 *     navigator.webdriver bot signal; with it, a fresh npmjs.com login plus
 *     OTP bounced straight back to signed-out, observed 2026-07-30). No
 *     `args` array, no other options. `--use-mock-keychain` is KEPT
 *     (Playwright's default): ignoring it forced Chrome through the real
 *     macOS keychain, which prompted with an invalid-keychain dialog on
 *     every launch.
 *   - ONE further ignored default, only when the profile carries the
 *     1Password extension: `--disable-extensions` would strip the operator's
 *     vault from the very window spawned for sign-in and OTP entry. A
 *     profile without the extension keeps the exact sanctioned pair, so
 *     nothing changes for it.
 */

import { browserChannel } from './browser-channel.mts'
import { profileHasOnePassword } from './one-password.mts'

/**
 * The only always-sanctioned `ignoreDefaultArgs` value — see the file header
 * for what it protects.
 */
export const REQUIRED_IGNORED_DEFAULT_ARGS: readonly string[] = Object.freeze([
  '--enable-automation',
] as const)

/**
 * The one conditional addition, layered in only when the launch profile
 * carries 1Password (see the file header).
 */
export const EXTENSION_IGNORED_DEFAULT_ARGS: readonly string[] = Object.freeze([
  '--disable-extensions',
] as const)

/**
 * The complete allowed launch-option shape. `chromiumSandbox` is the literal
 * type `true`: a launch that disables the sandbox is not a variant of the
 * shape, it is outside it.
 */
// Named a Shape, not Options: this is what `browserLaunchOptions()` RETURNS
// and is never a caller-facing parameter bag. Every member is required
// because the shape IS the complete law — an optional member would describe
// a launch that omits part of it.
export interface BrowserLaunchShape {
  channel: string
  chromiumSandbox: true
  headless: boolean
  ignoreDefaultArgs: readonly string[]
}

/**
 * Build the base allowed launch-options object, without extension layering.
 */
export function browserLaunchOptions(
  options?: { headless?: boolean | undefined } | undefined,
): BrowserLaunchShape {
  const { headless = false } = { __proto__: null, ...options } as NonNullable<
    typeof options
  >
  return {
    channel: browserChannel(),
    chromiumSandbox: true,
    headless,
    ignoreDefaultArgs: REQUIRED_IGNORED_DEFAULT_ARGS,
  }
}

/**
 * Build the launch-options object for a concrete profile: the base shape,
 * plus `--disable-extensions` dropped when the profile carries 1Password —
 * the difference between a vault that autofills the sign-in window and one
 * that silently never loads.
 */
export function browserLaunchOptionsForProfile(
  profileDir: string,
  options?: { headless?: boolean | undefined } | undefined,
): BrowserLaunchShape {
  const base = browserLaunchOptions(options)
  if (!profileHasOnePassword(profileDir)) {
    return base
  }
  return {
    ...base,
    ignoreDefaultArgs: [
      ...REQUIRED_IGNORED_DEFAULT_ARGS,
      ...EXTENSION_IGNORED_DEFAULT_ARGS,
    ],
  }
}

const LAUNCH_OPTION_KEYS = new Set([
  'channel',
  'chromiumSandbox',
  'headless',
  'ignoreDefaultArgs',
])

/**
 * Every way the given options diverge from the shape, in plain sentences.
 * Empty means allowed. The extension-layered triple is lawful here even
 * though the strict pair is what `browserLaunchOptions()` emits: a launch
 * against a 1Password profile is still inside the law. Pure — exported for
 * tests and for guards that want to report all divergences at once.
 */
export function launchViolations(launchOptions: unknown): string[] {
  if (typeof launchOptions !== 'object' || launchOptions === null) {
    return ['launch options must be an object matching BrowserLaunchShape']
  }
  const opts = launchOptions as Record<string, unknown>
  const violations: string[] = []
  if (opts['chromiumSandbox'] !== true) {
    violations.push(
      'chromiumSandbox must be exactly true — Playwright defaults the sandbox off by injecting a no-sandbox flag Chrome refuses',
    )
  }
  if (typeof opts['channel'] !== 'string' || opts['channel'] === '') {
    violations.push('channel must be a non-empty string (browserChannel())')
  }
  if (typeof opts['headless'] !== 'boolean') {
    violations.push('headless must be an explicit boolean')
  }
  const ignored = opts['ignoreDefaultArgs']
  const lawfulSets = [
    REQUIRED_IGNORED_DEFAULT_ARGS,
    [...REQUIRED_IGNORED_DEFAULT_ARGS, ...EXTENSION_IGNORED_DEFAULT_ARGS],
  ]
  const allowed =
    Array.isArray(ignored) &&
    lawfulSets.some(
      set =>
        ignored.length === set.length &&
        set.every(flag => ignored.includes(flag)),
    )
  if (!allowed) {
    violations.push(
      `ignoreDefaultArgs must be exactly [${REQUIRED_IGNORED_DEFAULT_ARGS.join(', ')}] (plus ${EXTENSION_IGNORED_DEFAULT_ARGS.join(', ')} when the profile carries 1Password)`,
    )
  }
  if ('args' in opts) {
    violations.push(
      'an args array is never allowed — the shape has no free-form flags',
    )
  }
  const keys = Object.keys(opts)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    if (!LAUNCH_OPTION_KEYS.has(key) && key !== 'args') {
      violations.push(
        `unexpected launch option \`${key}\` — the shape has exactly ${[...LAUNCH_OPTION_KEYS].join(', ')}`,
      )
    }
  }
  return violations
}

/**
 * Throw unless the options are exactly the lawful shape, listing every
 * divergence so a driver author fixes them all in one pass.
 */
export function assertBrowserLaunchOptions(launchOptions: unknown): void {
  const violations = launchViolations(launchOptions)
  if (violations.length > 0) {
    throw new Error(
      [
        'Unallowed Playwright launch options:',
        ...violations.map(v => `  - ${v}`),
      ].join('\n'),
    )
  }
}
