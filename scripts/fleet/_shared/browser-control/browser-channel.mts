/*
 * @file Browser channel resolution, exactly once. Duplicated in
 *   playwright-law.mts and inline in browser-session.mts; the override
 *   (SOCKET_BROWSER_CHANNEL=msedge / chromium / …) exists for a machine
 *   without Chrome installed — playwright-core cannot conjure a channel it
 *   has no binary for, so the operator points it at one they do have.
 */

import process from 'node:process'

/**
 * The Playwright channel to launch: system Chrome unless overridden.
 * Injectable env for tests.
 */
export function browserChannel(
  env: Record<string, string | undefined> = process.env,
): string {
  return env['SOCKET_BROWSER_CHANNEL'] || 'chrome'
}
