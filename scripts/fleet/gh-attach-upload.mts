#!/usr/bin/env node
/*
 * Upload images to GitHub's user-attachments CDN through the PR comment form,
 * the only supported upload path, then print the URLs.
 *
 * Brings up a real Chrome over CDP itself (the same launcher `gh:chrome` uses),
 * so nothing here is automation-launched for an extension or a managed policy to
 * refuse. A Chrome already on the port is adopted and left running, session and
 * all; one started here is closed when the upload finishes. First run in a fresh
 * CDP profile bounces to the login page and waits for the operator to sign in.
 */
import path from 'node:path'
import process from 'node:process'

import { chromium } from 'playwright-core'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { openChromeCdpSession } from './_shared/chrome-cdp.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'
import type { ElementHandle } from 'playwright-core'

const logger = getDefaultLogger()

const [maybeUrl, ...files] = process.argv.slice(2)
if (!maybeUrl || files.length === 0) {
  logger.error('usage: gh-attach-upload.mts <pr-url> <file> [more files]')
  process.exit(1)
}
const prUrl: string = maybeUrl

const CDP_URL = process.env['CDP_URL'] ?? 'http://localhost:9222'

async function main() {
  // A real Chrome over CDP, brought up HERE rather than by asking the operator
  // to go run gh:chrome first. Both commands share one launcher, so the only
  // difference between them is who starts the window, never how.
  //
  // There is deliberately NO automation-launched fallback. A Playwright-launched
  // browser is refusable: an extension or a managed policy can block a page in
  // it, which surfaces as ERR_BLOCKED_BY_CLIENT on exactly the GitHub login page
  // this flow needs. Falling back to one would trade a clear failure for a
  // confusing one, so a browser that cannot come up is reported and the run
  // stops.
  const session = await openChromeCdpSession({ cdpUrl: CDP_URL })
  // An endpoint already answering is the operator's window, holding the
  // signed-in session: adopted, used, and left running. One started here is
  // closed on the way out, so a command that opened a browser does not leave one.
  const browser = await chromium.connectOverCDP(session.cdpUrl)
  const ctx = browser.contexts()[0]
  if (!ctx) {
    session.close()
    throw new Error(
      `Connected to ${session.cdpUrl} but it exposed no browser context.`,
    )
  }
  logger.info(
    session.adopted
      ? `gh:attach: using the Chrome already on ${session.cdpUrl}.`
      : `gh:attach: started Chrome on ${session.cdpUrl} (profile ${session.profileDir}).`,
  )

  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(prUrl, { waitUntil: 'domcontentloaded' })

    // If GitHub bounces us to the login page, hand the window to the operator.
    if (page.url().includes('/login')) {
      // Always completable now: the browser is a real, visible Chrome, so there
      // is no headless case to refuse. The old HEADED=1 round trip existed only
      // because the fallback could be headless.
      logger.log(
        'Log into GitHub in the window; the script continues when the PR page loads.',
      )
      await page.waitForURL(`${prUrl}*`, { timeout: 300_000 })
    }

    const textarea = page.locator('textarea#new_comment_field')
    await textarea.scrollIntoViewIfNeeded()

    // GitHub's paste-markdown upload rides a hidden file input in the same form.
    const fileInput = page.locator(
      'form:has(textarea#new_comment_field) input[type=file]',
    )
    if ((await fileInput.count()) === 0) {
      throw new Error('no file input found next to the comment box')
    }
    // The locator selects `textarea#new_comment_field`, so the node is a
    // textarea. Playwright types a generic handle as HTMLElement | SVGElement,
    // neither of which carries `.value` - the in-page callback below reads it.
    const handle =
      (await textarea.elementHandle()) as ElementHandle<HTMLTextAreaElement> | null
    if (!handle) {
      throw new Error('comment textarea is not attached')
    }
    for (const file of files) {
      const before = await textarea.inputValue()
      await fileInput.first().setInputFiles(path.resolve(file))
      // The upload completes when the user-attachments URL lands in the textarea.
      await page.waitForFunction(
        ({ el, prev }) =>
          el.value !== prev && el.value.includes('user-attachments/assets'),
        { el: handle, prev: before },
        { timeout: 60_000 },
      )
      logger.info(`uploaded: ${path.basename(file)}`)
    }

    const value = await textarea.inputValue()
    const urls = [
      ...value.matchAll(
        /https:\/\/github\.com\/user-attachments\/assets\/[^\s)]+/g,
      ),
    ].map(m => m[0])
    logger.info('URLS:' + JSON.stringify(urls))

    // Leave no draft comment behind.
    await textarea.fill('')
  } finally {
    session.close()
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'attaches a local file to a GitHub comment box through an existing Chrome CDP session',
  help: `Usage: node scripts/fleet/gh-attach-upload.mts <url> <file>
  <url>   the issue / PR / comment URL whose comment box receives the upload
  <file>  path to the file to attach`,
}

// Entry-guarded: importing this module must not drive a browser session
// against the CALLER's argv, and `--describe`/`--help` have to reach the
// runner instead of the upload.
if (isMainModule(import.meta.url)) {
  runMain(async () => {
    try {
      await main()
    } catch (e: unknown) {
      logger.error(`upload failed: ${errorMessage(e)}`)
      process.exitCode = 1
    }
  }, SCRIPT_META)
}
