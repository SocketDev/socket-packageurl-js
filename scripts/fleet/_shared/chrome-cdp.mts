/*
 * @file Bring up the operator's real, branded Chrome with the DevTools protocol
 *   open, and wait until it answers. One owner for a launch two entry points
 *   need: `gh:chrome` as a standalone command, and `gh:attach`, which brings one
 *   up itself rather than telling the operator to go run the other command.
 *
 *   WHY THE REAL CHROME AND NOT A PLAYWRIGHT LAUNCH. A Playwright-launched
 *   browser is automation-launched, and that is visible: an extension or a
 *   managed policy can refuse a page in it, which surfaces as
 *   ERR_BLOCKED_BY_CLIENT on exactly the login pages these flows need. Chrome
 *   started here is an ordinary Chrome process that happens to have a debugging
 *   port open, so the operator's own profile, extensions, and policy posture
 *   apply and nothing has an automation flag to key off.
 *
 *   WHY A DEDICATED PROFILE DIR. Chrome ignores --remote-debugging-port when
 *   another instance already owns the profile, and an operator's everyday Chrome
 *   is usually running. Pointing at a separate dir is what makes the port
 *   actually open, at the cost of a one-time sign-in in that profile.
 *
 *   WHY THE CHILD IS NOT DETACHED. A detached child was measured to die with its
 *   parent and take the CDP port with it, so the launcher holds it instead and
 *   the caller decides when to let go. That makes ownership explicit, which
 *   matters for the case below.
 */

import process from 'node:process'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  CHROME_APP_BINARY,
  chromeIsInstalled,
} from './browser-control/chrome-binary.mts'
import { PROFILES } from './browser-control/profiles.mts'

export {
  CHROME_APP_BINARY,
  chromeIsInstalled,
} from './browser-control/chrome-binary.mts'

export const DEFAULT_CDP_PORT = '9222'
export const DEFAULT_CDP_PROFILE_DIR = PROFILES['cdpScratch']!.dir

/**
 * Whether a CDP endpoint is answering at `cdpUrl`.
 *
 * `/json/version` is the cheapest endpoint that proves a real DevTools host
 * rather than something else bound to the port: a plain TCP connect succeeds
 * against any listener, and handing a browser the wrong one fails much later
 * with a far worse message.
 */
export async function cdpAnswers(cdpUrl: string): Promise<boolean> {
  try {
    // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- localhost probe
    const res = await fetch(`${cdpUrl}/json/version`)
    return res.ok
  } catch {
    return false
  }
}

export interface ChromeCdpOptions {
  readonly cdpUrl?: string | undefined
  readonly port?: string | undefined
  readonly profileDir?: string | undefined
  /*
   * How long to wait for the port to answer. Chrome has to start, restore the
   * profile, and bind the port; on a cold profile that is seconds, not
   * milliseconds, and a caller that gives up early falls back to the automation
   * launch this exists to avoid.
   */
  readonly timeoutMs?: number | undefined
}

export interface ChromeCdpSession {
  /*
   * True when a browser was ALREADY answering, so this started nothing.
   *
   * The caller must not close that one: it is the operator's window, holding the
   * signed-in session these flows depend on. `close` honors this, and the flag
   * is exposed so a caller can say which case it is in.
   */
  readonly adopted: boolean
  readonly cdpUrl: string
  /*
   * Release the browser THIS call started, or do nothing when it was adopted.
   */
  readonly close: () => void
  readonly profileDir: string
  /*
   * Resolves when the browser this call started exits, however it exited.
   *
   * A caller that holds the terminal open for the window needs this: waiting on
   * a signal alone hangs forever when the operator just closes Chrome, which is
   * the ordinary way to end that flow. Resolves immediately for an adopted
   * browser, whose lifetime is not ours to wait on.
   */
  readonly whenClosed: Promise<void>
}

/**
 * Make a CDP endpoint available, starting Chrome only if one is not already up.
 *
 * Verify-state-before-acting: an operator who ran `gh:chrome`, or who has any
 * Chrome on the port, keeps that window and their session. Launching
 * unconditionally would spawn a second process that cannot bind the port and
 * leave the caller connecting to the first one regardless.
 *
 * Throws when Chrome is absent or the port never answers. Both are conditions a
 * caller has to decide about, and failing quietly here reads downstream as a
 * mysterious connect error against a browser nobody can find.
 */
export async function openChromeCdpSession(
  options?: ChromeCdpOptions | undefined,
): Promise<ChromeCdpSession> {
  const {
    cdpUrl: cdpUrlOption,
    port = process.env['CDP_PORT'] ?? DEFAULT_CDP_PORT,
    profileDir = process.env['GH_ATTACH_CHROME_PROFILE'] ??
      DEFAULT_CDP_PROFILE_DIR,
    timeoutMs = 20_000,
  } = { __proto__: null, ...options } as ChromeCdpOptions
  const cdpUrl = cdpUrlOption ?? `http://localhost:${port}`
  if (await cdpAnswers(cdpUrl)) {
    return {
      adopted: true,
      cdpUrl,
      close: () => {},
      profileDir,
      whenClosed: Promise.resolve(),
    }
  }
  if (!chromeIsInstalled()) {
    throw new Error(
      `Google Chrome is not installed at ${CHROME_APP_BINARY}, so no CDP browser can be started. ` +
        'Install Chrome, or point CDP_URL at a DevTools endpoint you started yourself.',
    )
  }
  const running = spawn(
    CHROME_APP_BINARY,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`],
    { stdio: 'ignore' },
  )
  // The spawn promise rejects when Chrome exits non-zero, including when the
  // caller closes it on purpose, so both arms settle the same way: the exit is
  // the signal, not the code. Claimed here so the rejection never surfaces as an
  // unhandled one.
  const whenClosed = running.then(
    () => {},
    () => {},
  )
  const chrome = running.process
  const close = (): void => {
    if (!chrome.killed) {
      chrome.kill()
    }
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- serial poll of one endpoint
    if (await cdpAnswers(cdpUrl)) {
      return { adopted: false, cdpUrl, close, profileDir, whenClosed }
    }
    // oxlint-disable-next-line no-await-in-loop -- paced poll
    await new Promise(resolve => {
      setTimeout(resolve, 250)
    })
  }
  close()
  throw new Error(
    `Chrome was started but ${cdpUrl} never answered within ${Math.round(timeoutMs / 1000)}s. ` +
      `Check for a Chrome already owning the profile at ${profileDir}.`,
  )
}
