/*
 * @file The acquisition API — the ONE module whose job is to open a
 *   controlled Chrome. Consumers declare intent (`profileId`, headedness)
 *   and receive a ready session: profile created, 1Password graft verified
 *   (warn-only — a session never breaks over the vault), stale singletons
 *   healed, live holders refused by name, the restore bubble cleared, the
 *   launch shape minted with extension layering, and the agent-banner init
 *   script injected when the cascaded asset exists. Every previous
 *   hand-rolled launch path (browser-session.mts's inline construction, the
 *   ghcr driver's bare launch) folds into this; the launch guard and CI
 *   check shrink to a backstop asserting nothing bypasses it.
 *   THE only sanctioned `launchPersistentContext` call in the fleet's
 *   browser tooling outside the rendering-chromium-to-png skill — see
 *   launch-shape.mts for why each launch clause exists.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { chromium } from 'playwright-core'
import type { BrowserContext, Page } from 'playwright-core'

import { browserLaunchOptionsForProfile } from './launch-shape.mts'
import {
  ensureOnePasswordGraft,
  profileHasOnePassword,
} from './one-password.mts'
import { profileById } from './profiles.mts'
import {
  clearStaleSingletons,
  markProfileExitedCleanly,
  profileInUseRefusal,
  SINGLETON_LOCK,
} from './singleton-lock.mts'

import { REPO_ROOT } from '../../paths.mts'

const logger = getDefaultLogger()

/**
 * The injectable options for {@link acquireBrowserSession}. `launch` lets
 * tests hand in a fake BrowserContext so no real Chrome ever starts.
 */
export interface AcquireOptions {
  readonly headless?: boolean | undefined
  readonly launch?:
    | ((config: {
        headless: boolean
        profileDir: string
      }) => Promise<BrowserContext>)
    | undefined
  readonly profileDir?: string | undefined
}

/**
 * A live controlled-Chrome session. The caller MUST call `close()`.
 */
export interface AcquiredSession {
  readonly close: () => Promise<void>
  readonly context: BrowserContext
  readonly page: Page
  readonly profileDir: string
}

/**
 * Acquire a controlled-Chrome session on a registered profile, applying the
 * profile's declared policy in order: graft → heal → refuse → bubble →
 * shape → launch → banner.
 */
export async function acquireBrowserSession(
  profileId: string,
  options?: AcquireOptions | undefined,
): Promise<AcquiredSession> {
  const opts = { __proto__: null, ...options } as AcquireOptions
  const { headless = false, launch } = opts
  const profile = profileById(profileId)
  const profileDir = opts.profileDir ?? profile.dir
  await fs.mkdir(profileDir, { recursive: true })
  // The 1Password graft is verified on every acquire (the freshness check
  // makes it cheap) but is warn-only here: a degraded vault must never cost
  // a session. The graft CLI is what surfaces hard failures to the operator.
  if (profile.onePasswordRequired && !launch) {
    const result = await ensureOnePasswordGraft(profileDir).catch(error => {
      logger.warn(
        `1Password graft check failed (${(error as Error).message}) — continuing without vault autofill.`,
      )
      return undefined
    })
    for (const c of result?.checks ?? []) {
      if (c.status !== 'pass') {
        logger.warn(`[1password:${c.name}] ${c.detail}`)
      }
    }
  }
  // Single-instance handling is skipped when a fake `launch` is injected: a
  // test never touches a real profile, and the operator's own Chrome must
  // not make the suite fail.
  if (!launch) {
    if (profile.singletonHeal && (await clearStaleSingletons(profileDir))) {
      logger.log(
        'cleared stale Chrome singleton artifacts (their holder is dead) — proceeding.',
      )
    }
    const refusal = profileInUseRefusal({
      lockHeld: existsSync(path.join(profileDir, SINGLETON_LOCK)),
      profileDir,
    })
    if (refusal !== undefined) {
      throw new Error(refusal)
    }
    if (profile.exitCleanlyMark) {
      await markProfileExitedCleanly(profileDir)
    }
  }
  const shape = browserLaunchOptionsForProfile(profileDir, { headless })
  // The launch call keeps the ignoreDefaultArgs as a LITERAL ternary: the CI
  // check (check/playwright-launches-are-sanctioned.mts) pins the option by
  // text scan everywhere, allowlist included, and a spread of
  // shape.ignoreDefaultArgs reads as an unpinned value. The literals are
  // exactly what browserLaunchOptionsForProfile minted above.
  const loadProfileExtensions = profileHasOnePassword(profileDir)
  const doLaunch =
    launch ??
    (launchConfig =>
      chromium.launchPersistentContext(launchConfig.profileDir, {
        channel: shape.channel,
        chromiumSandbox: true,
        headless: launchConfig.headless,
        ignoreDefaultArgs: loadProfileExtensions
          ? ['--enable-automation', '--disable-extensions']
          : ['--enable-automation'],
      }))
  const context = await doLaunch({ headless, profileDir })
  // The fleet agent-banner: the same corner ribbon the Playwright MCP
  // injects, so a human glancing at THIS window can also tell it is
  // agent-driven. Fail-open — a checkout without the cascaded asset still
  // gets a working session, just an unmarked one.
  const bannerPath = path.join(
    REPO_ROOT,
    '.config',
    'fleet',
    'playwright',
    'agent-banner.js',
  )
  if (existsSync(bannerPath) && typeof context.addInitScript === 'function') {
    await context.addInitScript({ path: bannerPath }).catch(() => undefined)
  }
  // A page that cannot be prepared costs the whole acquire — close the
  // context here, because the caller never receives a session to close.
  let page: Page
  try {
    page = context.pages()[0] ?? (await context.newPage())
  } catch (error) {
    await context.close()
    throw error
  }
  return {
    __proto__: null,
    close: () => context.close(),
    context,
    page,
    profileDir,
  } as AcquiredSession
}
