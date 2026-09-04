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
 *   It carries the approval too: once GitHub enables the "Authorize github"
 *   button, this clicks it. The permissions screen still renders in the
 *   sanctioned fleet browser session before that click lands, so the
 *   operator sees exactly what is being granted and can close the window to
 *   stop it; the click only removes the second mechanical step, the same
 *   way this removes the first.
 */

import { debugNs } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { BEST_EFFORT_CLICK_TIMEOUT_MS } from '../browser/timeouts.mts'

import { formatHumanGate } from '../cli/human-gate.mts'
import { browserSessionGate } from '../cli/human-gate.mts'
import {
  formAutoSubmitSource,
  installFormAutoSubmit,
} from './gh-form-auto-submit.mts'
import { waitForAuthorizeButton } from './gh-oauth-authorize.mts'
import {
  clickAccountChoice,
  clickOrgChoice,
  repoOwner,
} from './gh-org-choice.mts'
import { installOtpAutoVerify } from './gh-otp-verify.mts'
import { clickSigilSignIn, waitForSigilSignIn } from './gh-sigil-signin.mts'
import { openFleetBrowserSession } from './npm/browser-session.mts'

import type { FormAutoSubmitConfig } from './gh-form-auto-submit.mts'
import type { Locator, Page } from 'playwright-core'

const logger = getDefaultLogger()

const DEBUG_NS = 'fleet:gh-auth'

/**
 * The wordings GitHub's device-flow page shows once the grant is recorded.
 *
 * Matched as TEXT, not by class: GitHub's class names are content-hashed and
 * change with every web deploy, while these sentences are what the page exists
 * to say. Several because the wording differs between the device-activation
 * screen and the plain authorization one.
 */
export const GH_AUTH_SUCCESS_TEXTS: readonly RegExp[] = [
  /Congratulations, you're all set/i,
  /Device activated/i,
  /You're all set/i,
]

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
 * The page-side watcher that submits the device form the moment a WHOLE code is
 * in it, however it got there.
 *
 * The script already types the code it read from gh, but the operator types one
 * by hand often enough to matter: gh's first code expires while they sign in
 * and prints a second, or they clear the field and retype. GitHub's own page
 * does not submit on the last character, so a correct code then sits there
 * waiting for a click that the operator has to notice.
 *
 * Counts alphanumerics only, so the `XXXX-XXXX` dash the field formats in does
 * not read as a ninth character, and submits at most once per page: the input
 * handler fires on every keystroke, and a second click during navigation throws
 * inside the page.
 *
 * Submits the CODE FIELD'S OWN FORM, never the first submit control on the
 * page. A page-wide `button[type="submit"]` lookup is one DOM order away from
 * clicking the wrong control, and the wrong control on an authorization screen
 * is the Cancel that answers gh with `access_denied`. Scoped to the device path
 * for the same reason: nothing outside it should be able to arm this at all.
 *
 * The watcher itself lives in `gh-form-auto-submit.mts`, shared with the
 * two-factor screen; this module supplies the device screen's numbers.
 */
export const DEVICE_PATH_PREFIX = '/login/device'

/**
 * The window flag marking the device watcher installed. Distinct from the OTP
 * watcher's, so arming one cannot silence the other.
 */
export const DEVICE_AUTO_SUBMIT_FLAG = '__socketFleetDeviceAutoSubmit'

/**
 * The device screen's watcher configuration, exported so a test can assert the
 * numbers without launching a browser.
 */
export function deviceAutoSubmitConfig(): FormAutoSubmitConfig {
  return {
    boxSelector: CODE_BOX_SELECTOR,
    fieldSelector: CODE_FIELD_SELECTOR,
    flag: DEVICE_AUTO_SUBMIT_FLAG,
    length: DEVICE_CODE_LENGTH,
    paths: [DEVICE_PATH_PREFIX],
  }
}

/**
 * The substituted browser source for the device screen.
 */
export function deviceAutoSubmitSource(): string {
  return formAutoSubmitSource(deviceAutoSubmitConfig())
}

/**
 * Installs the auto-submit watcher for every page in the session.
 *
 * An init script rather than a one-shot evaluate: an expired code sends the
 * operator back through the form, and a watcher installed once against the
 * first render would be gone by then. It is inert on every other page, since
 * nothing else on github.com carries a device-code field.
 */
export async function installDeviceCodeAutoSubmit(page: Page): Promise<void> {
  await installFormAutoSubmit(page, deviceAutoSubmitConfig())
}

/**
 * Which sign-in gates have already been clicked in this session. Each gate is
 * clicked AT MOST ONCE: a second click is a second navigation on a page the
 * flow has already left.
 */
interface SignInGateState {
  readonly chose: boolean
  readonly choseOrg: boolean
  readonly choseSigil: boolean
}

/**
 * One pass over the sign-in gates GitHub can put in front of the device form,
 * in the order they appear: the account chooser, the organization SSO gate,
 * then Sigil for orgs that front GitHub with it. Answers the next state, which
 * the caller threads back in on its next poll.
 */
async function advanceSignInGates(
  page: Page,
  state: SignInGateState,
  config: {
    onChoseAccount?: ((what: string) => void) | undefined
    onChoseOrg?: ((what: string) => void) | undefined
    onSigilSignIn?: ((what: string) => void) | undefined
    org: string
    pollMs: number
    preferredAccount?: string | undefined
  },
): Promise<SignInGateState> {
  let { chose, choseOrg, choseSigil } = state
  // A chooser with ONE entry naming the wanted account is a click with no
  // decision in it. Tried once, and only inside the sign-in flow: a control
  // naming the operator on their own profile page is a link to that profile.
  if (!chose) {
    const account = await clickAccountChoice(page, {
      preferred: config.preferredAccount,
    })
    if (account) {
      chose = true
      config.onChoseAccount?.(account)
    }
  }
  // The organization gate: GitHub asks which org's SSO to satisfy, or puts an
  // interstitial in front of it. Which one it serves depends on whether the
  // session already holds an SSO grant, so both shapes are tried.
  if (!choseOrg) {
    const chosen = await clickOrgChoice(page, config.org)
    if (chosen) {
      choseOrg = true
      config.onChoseOrg?.(chosen)
    }
  }
  // The Sigil gate, for orgs that front GitHub with it. This lands BEFORE
  // GitHub's chooser and on a different HOST, where every lane above declines —
  // so without this the flow waits on a button nobody is going to press. The
  // caller's poll owns the cadence; the inner call only needs a window to watch
  // for the navigation.
  if (!choseSigil) {
    const signedIn = await clickSigilSignIn(page, {
      departureMs: config.pollMs,
    })
    if (signedIn) {
      choseSigil = true
      config.onSigilSignIn?.(signedIn)
    }
  }
  return { chose, choseOrg, choseSigil }
}

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
    onChoseAccount?: ((what: string) => void) | undefined
    onChoseOrg?: ((what: string) => void) | undefined
    onSigilSignIn?: ((what: string) => void) | undefined
    /**
     * The organization to pick when GitHub asks. Defaults to the org this
     * checkout's `origin` remote belongs to.
     */
    org?: string | undefined
    onWait?: ((where: string) => void) | undefined
    /**
     * The account to continue as when a chooser lists several. Defaults to the
     * login GitHub reports as already signed in on the page.
     */
    preferredAccount?: string | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<boolean> {
  const opts = { __proto__: null, ...options } as typeof options
  // GitHub's device code expires 900s (15 min) after gh requests it (RFC
  // 8628 default). 13 min leaves margin for the code to still be live once
  // sign-in finishes, while 5 min timed out mid password+2FA in practice.
  const budgetMs = opts.budgetMs ?? 13 * 60_000
  const pollMs = opts.pollMs ?? 1000
  const org = opts.org ?? repoOwner()
  let announced = false
  let gates: SignInGateState = {
    chose: false,
    choseOrg: false,
    choseSigil: false,
  }
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
      // The URL, because "sign in first" was the same message whether the
      // window showed a password box or a passkey prompt with no code field on
      // it at all - and the operator cannot act on a screen nobody named.
      opts.onWait?.(page.url())
    }
    // eslint-disable-next-line no-await-in-loop -- a poll IS sequential
    gates = await advanceSignInGates(page, gates, {
      onChoseAccount: opts.onChoseAccount,
      onChoseOrg: opts.onChoseOrg,
      onSigilSignIn: opts.onSigilSignIn,
      org,
      pollMs,
      preferredAccount: opts.preferredAccount,
    })
    // eslint-disable-next-line no-await-in-loop -- a poll IS sequential
    await page.waitForTimeout(pollMs)
  }
  return false
}

/**
 * Types `code` into the device form. Does not submit it - the auto-submit
 * watcher installed by {@link installDeviceCodeAutoSubmit} fires on the input
 * event this fill dispatches, once the field or every box holds a whole code,
 * so a second submit here would race it.
 *
 * GitHub has shipped this screen as one input and as eight single-character
 * boxes, so both are handled.
 */
export async function fillDeviceCode(page: Page, code: string): Promise<void> {
  const single = page.locator(CODE_FIELD_SELECTOR).first()
  if (await single.count()) {
    await focusCodeInput(single)
    await single.fill(formatDeviceCode(code))
    return
  }
  const boxes = page.locator(CODE_BOX_SELECTOR)
  const count = await boxes.count()
  if (count < DEVICE_CODE_LENGTH) {
    throw new Error(
      `The device page showed ${count} code input(s); expected one field or ${DEVICE_CODE_LENGTH} boxes.`,
    )
  }
  // Focus the FIRST box before the loop. The page advances focus itself as each
  // box fills, so it only needs to start in the right place.
  await focusCodeInput(boxes.first())
  // Filled in order, one await at a time: typing the boxes in parallel races
  // the page's own focus advance.
  for (let i = 0; i < DEVICE_CODE_LENGTH; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- ordered fill
    await boxes.nth(i).fill(code[i]!)
  }
}

/**
 * Put the caret in a code input, and leave it there.
 *
 * `focus()` first, not `click()`: a click is a hit-test, so a cookie banner or
 * a consent overlay sitting over the field makes it throw, while focus goes
 * straight to the element. The click still follows as a second attempt because
 * some pages arm their input handler on a real pointer event.
 *
 * This also matters when the AGENT does not get to fill the code. When GitHub
 * interrupts with a sign-in and the human gate hands the window back, a focused
 * field is the difference between the operator typing the code and the operator
 * hunting for where it goes. Every failure here is swallowed for that reason:
 * an unfocused field is a worse experience, not a broken login.
 */
async function focusCodeInput(input: Locator): Promise<void> {
  try {
    await input.focus()
  } catch {
    // Element not focusable yet; the click below is the second attempt.
  }
  try {
    await input.click({ timeout: BEST_EFFORT_CLICK_TIMEOUT_MS })
  } catch {
    // Overlay or a moving target. focus() above already placed the caret in
    // the common case, so this is best-effort.
  }
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
  // Before the navigation, so both watchers are in place for the first render
  // and for every re-render after it: a code that expires during sign-in sends
  // the operator back to this form with a fresh code to type.
  await installDeviceCodeAutoSubmit(session.page)
  // The two-factor screen's Verify click. The operator still TYPES their own
  // one-time code — nothing here reads, fills, or logs it — and this only
  // presses the button GitHub leaves for somebody to notice.
  await installOtpAutoVerify(session.page)
  await session.page.goto(DEVICE_LOGIN_URL, { waitUntil: 'domcontentloaded' })
  // A signed-out browser lands on a sign-in page, not the device form. Filling
  // it immediately fails against a page that was never the device screen, which
  // is what "showed 0 code input(s)" meant when this ran for real.
  const ready = await waitForDeviceForm(session.page, {
    signal: opts.signal,
    // Click play-by-play: noise on a working run, but the last one recorded
    // names the page a stall happened on.
    onChoseAccount: (what: string) => {
      debugNs(DEBUG_NS, `chose the account entry "${what}" on the chooser`)
    },
    onChoseOrg: (what: string) => {
      debugNs(DEBUG_NS, `chose the organization entry "${what}"`)
    },
    onSigilSignIn: (what: string) => {
      debugNs(DEBUG_NS, `pressed "${what}" on the Sigil interstitial`)
    },
    onWait: (where: string) => {
      // A gate block, not a log line. The steps left here are the ones a
      // person genuinely has to perform — a password, a one-time code, a
      // passkey — and an operator who cannot tell "it is waiting on me" from
      // "it is stuck" leaves the window alone until the code expires.
      logger.info(
        formatHumanGate(
          browserSessionGate(
            `GitHub sign-in is unfinished, so ${where} shows no code field.`,
            'sign in to the open Chrome window: password, then 2FA or passkey.',
            'none — the window is open and the agent is watching it.',
            'the code fills itself in and the grant is authorized.',
          ),
        ).join('\n'),
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

  // Sigil can land a SECOND time, between the submitted code and the OAuth
  // page. The pre-form loop above only covers the first appearance, so without
  // this the flow sat on the interstitial until the code expired.
  //
  // Optional and silent when absent: most orgs never see this page, and the
  // helper returns early on any URL that is not Sigil. It polls because the
  // control fades in behind a delay, so one look can arrive too early.
  const sigilAfterCode = await waitForSigilSignIn(session.page).catch(() => '')
  if (sigilAfterCode) {
    logger.info(
      `gh:auth: pressed "${sigilAfterCode}" on the Sigil interstitial after the code.`,
    )
  }

  // The OAuth authorization page: GitHub shows the "Authorize github" button
  // disabled while it checks the operator's session, then enables it after a
  // moment. Waiting for it to be clickable and clicking it is the mechanical
  // half of the approval — the operator still reviews the permissions on
  // screen before the click lands.
  const authorize = await waitForAuthorizeButton(session.page, {
    signal: opts.signal,
  })
  if (authorize === 'clicked') {
    // The click landing and the grant being approved are two different facts,
    // and only gh knows the second — so this stays a DID, never an achieved.
    debugNs(DEBUG_NS, 'clicked Authorize on the OAuth page')
  } else if (authorize === 'not-found') {
    // Last lane before handing it back: the selector-driven waiter above keys
    // on GitHub's grant-screen markup, so a markup change takes it out while
    // the button is still there under its accessible name. Observed live - the
    // operator scrolled to "Authorize github" and clicked it by hand.
    const { clickAuthButton } = await import('../browser/control/auth-flow.mts')
    const clickedByName = await clickAuthButton(session.page, [
      /^\s*authorize\b/i,
      /^\s*continue\b/i,
    ])
    if (clickedByName) {
      debugNs(DEBUG_NS, 'clicked Authorize via the accessible-name fallback')
    } else {
      // Silence here read as success. The agent never clicked Authorize on a
      // real run and said nothing about it, so the operator was left to notice
      // the stalled window on their own.
      logger.info(
        formatHumanGate(
          browserSessionGate(
            'the agent could not land a click on Authorize within its budget, so the grant is still pending.',
            'scroll to the bottom of the open Chrome window and click Authorize yourself.',
            'nothing to say — the agent tried and is reporting that it failed.',
            'gh reports the outcome of the grant below.',
          ),
        ).join('\n'),
      )
    }
  }

  // Close as soon as GitHub's own page says the grant landed, rather than only
  // when gh exits. Two reasons it earns its place beside the signal wait below:
  // a caller that passes NO signal never reached a close at all, and even with
  // one the window lingered from the approval until gh finished polling, which
  // the operator then cleared by hand.
  //
  // Detached, and a miss costs nothing — the signal path still closes.
  const { closeOnAuthSuccess } =
    await import('../browser/control/auth-flow.mts')
  void closeOnAuthSuccess(session.page, GH_AUTH_SUCCESS_TEXTS, {
    close: () => session.close(),
  })

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
