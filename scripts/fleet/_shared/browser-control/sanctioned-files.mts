/*
 * @file The ONE list of files sanctioned to own a Playwright launch call,
 *   and the one matcher. Before this module the allowlist lived twice — an
 *   array in check/playwright-launches-are-sanctioned.mts and a path-suffix
 *   function in the playwright-launch-guard hook — and the two drifted by
 *   hand. Both enforcers now import from here, so the backstop asserts the
 *   same thing at write time (hook) and in CI (check). The list shrank when
 *   the control plane landed: browser-session.mts delegates to acquire.mts
 *   and the ghcr driver migrated onto the plane, leaving the plane itself
 *   and the rendering-chromium-to-png skill (a different contract — headless
 *   chromium with --load-extension, no durable profile, no sign-in).
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * Path suffixes sanctioned to contain a `launchPersistentContext(` call.
 * Matching is by suffix/includes so both the template path and its cascaded
 * mirror path satisfy the same entry.
 */
export const SANCTIONED_LAUNCH_OWNERS: readonly string[] = Object.freeze([
  'scripts/fleet/_shared/browser-control/acquire.mts',
  '/rendering-chromium-to-png/',
] as const)

/**
 * True when `filePath` is sanctioned to own a launch call. Pure.
 */
export function isSanctionedSessionOwner(
  filePath: string,
  options?: { allowlist?: readonly string[] | undefined } | undefined,
): boolean {
  const { allowlist = SANCTIONED_LAUNCH_OWNERS } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const p = normalizePath(filePath)
  return allowlist.some(rawEntry => {
    const entry = normalizePath(rawEntry)
    return entry.includes('/')
      ? p.endsWith(entry) || p.includes(entry)
      : p.endsWith(entry)
  })
}
