#!/usr/bin/env node
/*
 * Launch the real, user-branded Chrome with the DevTools protocol open, and hold
 * it there. Log into whatever you need in the window; later commands attach over
 * CDP. Close Chrome (or Ctrl-C here) to end the script.
 *
 * `gh:attach` no longer needs this run first — it brings up a browser itself
 * through the same launcher (`_shared/chrome-cdp.mts`). This stays for the case
 * where the sign-in and the work happen at different times, or where an operator
 * wants one long-lived window several commands attach to in turn.
 *
 * Held in the FOREGROUND on purpose: a detached child was measured to die with
 * its parent and take the CDP port with it.
 */

import process from 'node:process'

import { onExit } from '@socketsecurity/lib-stable/events/exit/handler'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  DEFAULT_CDP_PORT,
  DEFAULT_CDP_PROFILE_DIR,
  openChromeCdpSession,
} from './_shared/chrome-cdp.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

const PORT = process.env['CDP_PORT'] ?? DEFAULT_CDP_PORT
const PROFILE_DIR =
  process.env['GH_ATTACH_CHROME_PROFILE'] ?? DEFAULT_CDP_PROFILE_DIR

const SCRIPT_META: ScriptMeta = {
  describe:
    'launches real Chrome with the DevTools protocol open and holds it for later CDP attaches',
  help: 'Usage: node scripts/fleet/gh-chrome-cdp.mts',
}

export async function main(): Promise<void> {
  const session = await openChromeCdpSession({
    port: PORT,
    profileDir: PROFILE_DIR,
  })
  if (session.adopted) {
    // Nothing to hold: the window belongs to whoever started it, and closing it
    // here would take their signed-in session with it.
    logger.info(
      `A CDP browser already answers on ${session.cdpUrl} — keeping it, and your session with it.`,
    )
    return
  }
  logger.info(
    `Chrome is up with CDP on ${session.cdpUrl} (profile ${session.profileDir}).`,
  )
  logger.info(
    'Log into GitHub in the window, then run the attach command. ' +
      'Close Chrome (or Ctrl-C here) to end this script.',
  )
  // Hold the process open for as long as the window lives. Returning early would
  // give the terminal back and kill the port, which is the whole reason this is
  // not a detached launch.
  //
  // `onExit` rather than hand-registered SIGINT/SIGTERM listeners: it covers the
  // whole signal set plus a plain exit, and hands back a remover so the handler
  // does not outlive the wait. A hand-rolled pair silently misses SIGHUP, which
  // is what a closed terminal sends.
  //
  // Either ending counts, so both are awaited: the operator interrupts here, or
  // just closes Chrome. Waiting on the signal alone hangs after a window close,
  // which is the ordinary way to finish.
  const removeExitHandler = onExit(() => {
    session.close()
  })
  try {
    await session.whenClosed
  } finally {
    removeExitHandler()
    session.close()
  }
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
