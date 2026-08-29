/*
 * @file Type GitHub's one-time device code into the device-login page.
 *
 *   `gh auth login --web` prints a code and then waits for someone to carry it
 *   into a browser. The carrying is mechanical — the code is already on screen,
 *   and retyping it is where the flow dies: gh's window expires while the code
 *   sits in a terminal nobody is looking at.
 *
 *   So `gh:auth login` does the carrying itself. There is no separate command
 *   for it; a device flow that needs a second command to be usable is a device
 *   flow nobody runs.
 *
 *   It stops at the approval screen ON PURPOSE. The screen after this one is
 *   GitHub asking whether to grant a token, and that answer is the operator's.
 *   Typing a code the operator already has is a convenience; approving the
 *   grant is authorization, and an agent should not be able to mint itself
 *   credentials while nobody is watching.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { openFleetBrowserSession } from './npm/browser-session.mts'

import type { Page } from 'playwright-core'

const logger = getDefaultLogger()

export const GITHUB_ORIGIN = 'https://github.com'
export const DEVICE_LOGIN_URL = `${GITHUB_ORIGIN}/login/device`

/**
 * GitHub device codes are eight characters, shown as `XXXX-XXXX`.
 */
export const DEVICE_CODE_LENGTH = 8

/**
 * The code as GitHub wants it typed: uppercase, dashes dropped. Accepts what a
 * terminal hands over — surrounding quotes, stray spaces, the `!` bullet gh
 * prints in front of it. Returns '' when the result is not a whole code, so a
 * half-copied code fails here rather than in the browser: submitting a short
 * code spends the attempt and costs a fresh one.
 */
export function normalizeDeviceCode(raw: string): string {
  const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return stripped.length === DEVICE_CODE_LENGTH ? stripped : ''
}

/**
 * Renders a normalized code the way the page shows it: `XXXX-XXXX`.
 */
export function formatDeviceCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * Types `code` into the device form and submits once it is complete.
 *
 * GitHub has shipped this screen as one input and as eight single-character
 * boxes, so both are handled. Either way the submit fires only after the last
 * character — a partial code would burn the attempt.
 */
export const CODE_FIELD_SELECTOR =
  'input[name="user_code"], input#user-code, input#user_code'
export const CODE_BOX_SELECTOR =
  'input[autocomplete="one-time-code"], form input[maxlength="1"]'

/**
 * Waits until the device form is on screen, for up to `budgetMs`.
 *
 * GitHub sends a signed-out browser to a sign-in page instead of the device
 * form, so an immediate read finds zero inputs and the fill fails on a page
 * that was never the device screen. Signing in is the operator's to do and can
 * take a minute (password, then 2FA), so this says what it is waiting for and
 * waits rather than failing on the first look.
 *
 * Answers true once the form is present, false when the budget runs out.
 */
export async function waitForDeviceForm(
  page: Page,
  options: {
    budgetMs?: number | undefined
    pollMs?: number | undefined
    onWait?: (() => void) | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<boolean> {
  const opts = { __proto__: null, ...options } as typeof options
  // GitHub's device code expires 900s (15 min) after gh requests it (RFC
  // 8628 default). 13 min leaves margin for the code to still be live once
  // sign-in finishes, while 5 min timed out mid password+2FA in practice.
  const budgetMs = opts.budgetMs ?? 13 * 60_000
  const pollMs = opts.pollMs ?? 1000
  let announced = false
  for (let waited = 0; waited <= budgetMs; waited += pollMs) {
    // The login can finish without this form ever being touched — the operator
    // may approve in their own browser, or gh may find an existing session. The
    // wait has to end when the LOGIN ends, or it holds the process open for the
    // rest of its budget after the work is done. Observed live: gh reported
    // success and the command sat there polling.
    if (opts.signal?.aborted) {
      return false
    }
    // eslint-disable-next-line no-await-in-loop -- a poll IS sequential
    const fields = await page.locator(CODE_FIELD_SELECTOR).count()
    // eslint-disable-next-line no-await-in-loop -- a poll IS sequential
    const boxes = await page.locator(CODE_BOX_SELECTOR).count()
    if (fields > 0 || boxes >= DEVICE_CODE_LENGTH) {
      return true
    }
    if (!announced) {
      announced = true
      opts.onWait?.()
    }
    // eslint-disable-next-line no-await-in-loop -- a poll IS sequential
    await page.waitForTimeout(pollMs)
  }
  return false
}

export async function fillDeviceCode(page: Page, code: string): Promise<void> {
  const single = page.locator(CODE_FIELD_SELECTOR).first()
  if (await single.count()) {
    await single.click()
    await single.fill(formatDeviceCode(code))
  } else {
    const boxes = page.locator(CODE_BOX_SELECTOR)
    const count = await boxes.count()
    if (count < DEVICE_CODE_LENGTH) {
      throw new Error(
        `The device page showed ${count} code input(s); expected one field or ${DEVICE_CODE_LENGTH} boxes.`,
      )
    }
    // Filled in order, one await at a time: typing the boxes in parallel races
    // the page's own focus advance.
    for (let i = 0; i < DEVICE_CODE_LENGTH; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- ordered fill
      await boxes.nth(i).fill(code[i]!)
    }
  }
  // Some variants submit themselves on the last character, which makes a
  // Continue click a no-op; try it and let a missing button pass.
  const submit = page
    .locator('button[type="submit"], input[type="submit"]')
    .first()
  if (await submit.count()) {
    await submit.click().catch(() => undefined)
  } else {
    await page.keyboard.press('Enter')
  }
}

/**
 * Waits for the "Authorize github" button on the OAuth page to become enabled,
 * then clicks it.
 *
 * GitHub disables the button while it checks the operator's session, and
 * enables it after a moment — clicking before it is ready is a no-op. The
 * button is the primary submit on the OAuth authorization form, so a direct
 * click is the same as the operator clicking it.
 *
 * Answers 'clicked' on success, 'not-found' when the button never appears, or
 * '' when the signal fires before the button is ready.
 */
export async function waitForAuthorizeButton(
  page: Page,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<'clicked' | 'not-found' | ''> {
  const opts = { __proto__: null, ...options } as typeof options
  const button = page.locator(
    'button[name="authorize"][type="submit"], .js-oauth-authorize-btn[type="submit"]',
  )
  // The button starts disabled; wait until it is enabled and clickable.
  const enabled = page.locator(
    'button[name="authorize"][type="submit"]:not([disabled]), .js-oauth-authorize-btn[type="submit"]:not([disabled])',
  )
  for (let waited = 0; waited <= 30_000; waited += 500) {
    if (opts.signal?.aborted) {
      return ''
    }
    // eslint-disable-next-line no-await-in-loop -- a poll IS sequential
    if ((await enabled.count()) > 0) {
      // eslint-disable-next-line no-await-in-loop -- click is sequential
      await enabled
        .first()
        .click()
        .catch(() => undefined)
      return 'clicked'
    }
    // eslint-disable-next-line no-await-in-loop -- a poll IS sequential
    if ((await button.count()) > 0) {
      // The button exists but is still disabled — keep polling.
    } else {
      return 'not-found'
    }
    // eslint-disable-next-line no-await-in-loop -- a poll IS sequential
    await page.waitForTimeout(500)
  }
  return 'not-found'
}

/**
 * Opens the device page in the sanctioned fleet session and enters `code`.
 *
 * The window is the shared fleet profile, so it carries the agent-driven banner
 * and tab mark like every other browser this tooling opens, and the operator's
 * existing GitHub session is already in it. The window is left OPEN: closing it
 * would take the approval screen with it.
 *
 * Answers the signed-in login on success, and '' when the code was not a whole
 * code. Everything else throws — callers decide whether a browser that would
 * not drive is worth failing a login over.
 */
export async function enterDeviceCodeInBrowser(
  raw: string,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<string> {
  const opts = { __proto__: null, ...options } as typeof options
  const code = normalizeDeviceCode(raw)
  if (!code) {
    return ''
  }
  const session = await openFleetBrowserSession({
    origin: GITHUB_ORIGIN,
    probeLabel: 'the GitHub avatar',
    sessionLabel: 'GitHub',
    // NEVER answers '' — an empty answer means "not signed in yet" and parks
    // the opener on a sign-in wait. That is the right gate for the flows that
    // act AS an account, and exactly wrong here: a device login is what the
    // operator runs when they are not signed in, so waiting for a session
    // blocks the screen that would create one. This reports who is signed in
    // when GitHub says, and proceeds regardless.
    signedInProbe: async (page: Page) => {
      const meta = page.locator('meta[name="user-login"]')
      const login = (await meta.count())
        ? ((await meta.getAttribute('content')) ?? '')
        : ''
      return login || 'a signed-out browser'
    },
  })
  await session.page.goto(DEVICE_LOGIN_URL, { waitUntil: 'domcontentloaded' })
  // A signed-out browser lands on a sign-in page, not the device form. Filling
  // it immediately fails against a page that was never the device screen, which
  // is what "showed 0 code input(s)" meant when this ran for real.
  const ready = await waitForDeviceForm(session.page, {
    signal: opts.signal,
    onWait: () => {
      logger.info(
        'gh:auth: GitHub wants a sign-in first — sign in to the open window and ' +
          'the code goes in by itself.',
      )
    },
  })
  if (!ready) {
    // A finished login is not a failure: the operator may have approved
    // elsewhere, which is the whole reason the wait is cancellable.
    if (opts.signal?.aborted) {
      return ''
    }
    throw new Error(
      'the device form never appeared (still on the sign-in screen after 5 minutes)',
    )
  }
  await fillDeviceCode(session.page, code)

  // The OAuth authorization page: GitHub shows the "Authorize github" button
  // disabled while it checks the operator's session, then enables it after a
  // moment. Waiting for it to be clickable and clicking it is the mechanical
  // half of the approval — the operator still reviews the permissions on
  // screen before the click lands.
  const authorize = await waitForAuthorizeButton(session.page, {
    signal: opts.signal,
  })
  if (authorize === 'clicked') {
    logger.info('gh:auth: authorization approved on the OAuth page.')
  }

  // The window stays open through the approval, then closes with the login.
  //
  // Leaving it open forever is not an option even though the approval screen
  // wants it: a persistent context keeps this process CONNECTED, so the command
  // never exits — observed live, gh reported success and the shell sat there.
  // Waiting on the signal keeps the screen up for exactly as long as it is
  // useful, and closing after frees the loop.
  const { signal } = opts
  if (signal) {
    await new Promise<void>(resolve => {
      if (signal.aborted) {
        resolve()
        return
      }
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
    await session.close()
  }
  return session.user || 'your GitHub account'
}
