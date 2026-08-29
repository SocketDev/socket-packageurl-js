/*
 * @file The ONE Chrome binary path. It was hardcoded in three places
 *   (chrome-cdp.mts, open-url.mts's NEW_WINDOW_BROWSERS, npm-auth-browser.mts)
 *   and any fourth surface would have copied it again. The env override
 *   (SOCKET_BROWSER_BINARY) is for a machine whose Chrome lives elsewhere.
 */

import { existsSync } from 'node:fs'
import process from 'node:process'

/**
 * The stock macOS Chrome binary.
 */
export const CHROME_APP_BINARY =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/**
 * The Chrome binary to launch: the env override when set, else the stock
 * path. Injectable env for tests.
 */
export function chromeBinary(
  env: Record<string, string | undefined> = process.env,
): string {
  return env['SOCKET_BROWSER_BINARY'] || CHROME_APP_BINARY
}

/**
 * Whether the resolved (or given) Chrome binary exists on this machine.
 */
export function chromeIsInstalled(
  options?: { binary?: string | undefined } | undefined,
): boolean {
  const { binary = chromeBinary() } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  return existsSync(binary)
}
