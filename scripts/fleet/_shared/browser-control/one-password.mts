/*
 * @file 1Password in every controlled browser: detection (folded from
 *   browser-session.mts) and the same-machine profile GRAFT that installs
 *   the extension where the Chrome Web Store cannot. Why a graft exists at
 *   all: this fleet's machines are work-managed, and the Chrome cloud policy
 *   ExtensionInstallAllowlist permits exactly one extension id — a fresh
 *   automation profile cannot install 1Password from the store ("blocked by
 *   administrator", observed 2026-08-14). The operator's MAIN Chrome profile
 *   already carries the extension, so the graft copies its registration and
 *   files into the target profile. A same-machine copy keeps the Secure
 *   Preferences / Local State HMACs valid (the MAC seed is machine-scoped),
 *   the extension keeps its official Web Store id, and the 1Password native
 *   messaging host manifest already allowlists that id — so the extension
 *   integrates with the unlocked desktop app and the vault autofills the
 *   windows we spawn. `--load-extension` (unpacked) is NOT a substitute: it
 *   mints a random extension id the native messaging manifest refuses,
 *   killing the desktop-app session the graft exists to leverage.
 */

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { clearStaleSingletons, singletonLockHeld } from './singleton-lock.mts'

const logger = getDefaultLogger()

/**
 * Chrome Web Store id of the 1Password extension. This is PUBLIC data, not a
 * secret: every Web Store extension's id is the trailing path segment of its
 * public listing URL — verified 2026-08-06 at
 * https://chromewebstore.google.com/detail/aeblfdkhhhdcdjpifhhbdiojplfjncoa
 * ("1Password – Password Manager") — and the same id names the extension's
 * install directory under the Chrome profile
 * (`<profile>/Default/Extensions/<id>`). When the durable profile carries
 * it, the launch also drops Playwright's `--disable-extensions` default so
 * the operator's vault can autofill sign-in and OTP pages in the window we
 * spawn for auth.
 */
export const ONE_PASSWORD_EXTENSION_IDS: readonly string[] = Object.freeze([
  'aeblfdkhhhdcdjpifhhbdiojplfjncoa',
] as const)

const ONE_PASSWORD_APP = '/Applications/1Password.app'

/**
 * The Chrome user-data-dir the operator's everyday browser uses — the graft
 * source. Overridable for tests and unusual layouts.
 */
export const DEFAULT_SOURCE_USER_DATA_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome',
)

/**
 * The native messaging host manifests 1Password installs for Chrome. When
 * none allowlists the official extension id, the grafted extension still
 * loads but cannot talk to the desktop app — the vault never unlocks.
 */
const NATIVE_MESSAGING_MANIFESTS = [
  'com.1password.1password.json',
  'com.agilebits.onepassword4.json',
]

/**
 * The files and directories the graft copies, relative to the Chrome
 * user-data-dir (or the `Default` profile inside it). Secure Preferences and
 * Local State carry the extension registration and the MAC seed; the rest is
 * the extension's own code and local state. Cookies, history, cache, and
 * every other extension are deliberately NOT copied.
 */
const GRAFT_STATE_FILE = '.one-password-graft.json'

/**
 * Whether the profile carries a known password-manager extension, checked in
 * the two places Chrome materializes installed extensions (the default
 * profile subdirectory and the profile root). Pure over the filesystem —
 * exported for tests.
 */
export function profileHasOnePassword(
  profileDir: string,
  options?: { ids?: readonly string[] | undefined } | undefined,
): boolean {
  const { ids = ONE_PASSWORD_EXTENSION_IDS } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  return ids.some(
    id =>
      existsSync(path.join(profileDir, 'Default', 'Extensions', id)) ||
      existsSync(path.join(profileDir, 'Extensions', id)),
  )
}

/**
 * One precondition check's outcome. `warn` means the graft proceeds but
 * something will be degraded; `fail` means the graft cannot happen and the
 * detail names the fix.
 */
export interface GraftCheck {
  readonly detail: string
  readonly name: string
  readonly status: 'fail' | 'pass' | 'warn'
}

/**
 * What {@link ensureOnePasswordGraft} did: every check it ran (in order) and
 * whether files were actually copied. `grafted` is also true when the graft
 * was already fresh — the state is present, just not re-copied.
 */
export interface GraftResult {
  readonly checks: readonly GraftCheck[]
  readonly grafted: boolean
  readonly skipped: boolean
}

interface GraftStateFile {
  graftedAt: string
  sourceExtensionMtimeMs: number
  sourceProfile: string
  sourceVersion: string
}

function check(
  name: string,
  status: GraftCheck['status'],
  detail: string,
): GraftCheck {
  return { __proto__: null, detail, name, status } as GraftCheck
}

/**
 * The newest version directory of the extension inside a profile's
 * `Default/Extensions/<id>` (Chrome keeps one dir per installed version),
 * or undefined when the extension is absent. Exported for tests.
 */
export async function extensionVersionDir(
  profileDir: string,
  options?: { id?: string | undefined } | undefined,
): Promise<{ dir: string; version: string } | undefined> {
  const { id = ONE_PASSWORD_EXTENSION_IDS[0]! } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const extensionsDir = path.join(profileDir, 'Default', 'Extensions', id)
  let entries: string[]
  try {
    entries = await fs.readdir(extensionsDir)
  } catch {
    return undefined
  }
  const versions = entries.filter(e => !e.startsWith('.')).toSorted()
  const version = versions[versions.length - 1]
  if (version === undefined) {
    return undefined
  }
  return { dir: path.join(extensionsDir, version), version }
}

async function copyDirRecursive(source: string, target: string): Promise<void> {
  await fs.cp(source, target, { recursive: true })
}

async function copyIfPresent(source: string, target: string): Promise<boolean> {
  if (!existsSync(source)) {
    return false
  }
  // oxlint-disable-next-line socket/prefer-exists-sync -- needs isDirectory()
  const stat = await fs.stat(source)
  if (stat.isDirectory()) {
    await copyDirRecursive(source, target)
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(source, target)
  }
  return true
}

/**
 * Whether the operator's everyday Chrome is running against the source
 * user-data-dir. Best-effort: a live Chrome rewrites its leveldb-backed
 * extension state as we copy it, so the graft warns rather than trusting a
 * possibly-torn copy of the extension's own data (the registration files —
 * Secure Preferences, Local State — are small atomic rewrites and copy
 * cleanly either way).
 */
async function sourceChromeRunning(
  sourceUserDataDir: string,
): Promise<boolean> {
  return singletonLockHeld(sourceUserDataDir)
}

async function readGraftState(
  targetProfileDir: string,
): Promise<GraftStateFile | undefined> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(targetProfileDir, GRAFT_STATE_FILE), 'utf8'),
    ) as GraftStateFile
  } catch {
    return undefined
  }
}

/**
 * Verify (and when stale or absent, perform) the 1Password graft into
 * `targetProfileDir`. Every precondition is checked in order and handled on
 * its own terms — see the checks table in the module doc and the plan:
 * optional degradations warn and proceed, required pieces fail with the fix
 * named. A LIVE Chrome holding the TARGET profile skips the copy entirely:
 * grafting under a running browser is thrown away when it exits, and killing
 * someone's window is not this function's place.
 */
export async function ensureOnePasswordGraft(
  targetProfileDir: string,
  options?:
    | {
        dryRun?: boolean | undefined
        sourceUserDataDir?: string | undefined
      }
    | undefined,
): Promise<GraftResult> {
  const { dryRun = false, sourceUserDataDir = DEFAULT_SOURCE_USER_DATA_DIR } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const id = ONE_PASSWORD_EXTENSION_IDS[0]!
  const checks: GraftCheck[] = []
  const fail = (name: string, detail: string): GraftResult => {
    checks.push(check(name, 'fail', detail))
    return { checks, grafted: false, skipped: false }
  }

  // 1. The desktop app is what unlocks the vault; without it the extension
  // still loads but stands alone.
  if (existsSync(ONE_PASSWORD_APP)) {
    checks.push(check('desktop-app', 'pass', ONE_PASSWORD_APP))
  } else {
    checks.push(
      check(
        'desktop-app',
        'warn',
        '1Password desktop app not found — the grafted extension loads but vault autofill is unavailable until the app is installed.',
      ),
    )
  }

  // 2-4. The source profile must actually carry the extension.
  if (!existsSync(sourceUserDataDir)) {
    return fail(
      'source-profile',
      `Chrome profile not found at ${sourceUserDataDir}. Open Chrome at least once to create it.`,
    )
  }
  checks.push(check('source-profile', 'pass', sourceUserDataDir))
  const source = await extensionVersionDir(sourceUserDataDir, { id })
  if (source === undefined) {
    return fail(
      'source-extension',
      `1Password is not installed in your main Chrome (${sourceUserDataDir}). Install it from https://chromewebstore.google.com/detail/${id} first.`,
    )
  }
  checks.push(check('source-extension', 'pass', `version ${source.version}`))

  // 5. The target may not exist yet — a first graft creates it.
  if (!existsSync(targetProfileDir)) {
    checks.push(
      check('target-profile', 'warn', `${targetProfileDir} will be created.`),
    )
  } else {
    checks.push(check('target-profile', 'pass', targetProfileDir))
  }

  // 6. Native messaging is the desktop-app bridge.
  const manifestDir = path.join(sourceUserDataDir, 'NativeMessagingHosts')
  const manifestFound = await (async (): Promise<string | undefined> => {
    for (
      let i = 0, { length } = NATIVE_MESSAGING_MANIFESTS;
      i < length;
      i += 1
    ) {
      const file = path.join(manifestDir, NATIVE_MESSAGING_MANIFESTS[i]!)
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as {
          allowed_origins?: unknown | undefined
        }
        const origins = parsed.allowed_origins
        if (
          Array.isArray(origins) &&
          origins.some(o => typeof o === 'string' && o.includes(id))
        ) {
          return file
        }
      } catch {
        // A missing or unreadable manifest falls through to the next name.
      }
    }
    return undefined
  })()
  if (manifestFound !== undefined) {
    checks.push(check('native-messaging', 'pass', manifestFound))
  } else {
    checks.push(
      check(
        'native-messaging',
        'warn',
        'no 1Password native messaging manifest allowlists the official extension id — the grafted extension cannot talk to the desktop app. Open 1Password → Settings → Browser and reconnect Chrome.',
      ),
    )
  }

  // 7. A live source Chrome means the extension's own data dirs may copy
  // torn; registration files are atomic and fine either way.
  if (await sourceChromeRunning(sourceUserDataDir)) {
    checks.push(
      check(
        'source-running',
        'warn',
        'your main Chrome is running — extension-data dirs copy best-effort. If the grafted extension misbehaves, quit Chrome and re-run the graft.',
      ),
    )
  } else {
    checks.push(check('source-running', 'pass', 'source Chrome not running'))
  }

  // 8. Never graft under a live target Chrome: the copy is thrown away when
  // it exits, and killing the window is not our place.
  if (existsSync(targetProfileDir)) {
    if (await clearStaleSingletons(targetProfileDir)) {
      checks.push(
        check(
          'target-lock',
          'warn',
          'cleared stale Chrome singleton artifacts (their holder is dead).',
        ),
      )
    }
    if (await singletonLockHeld(targetProfileDir)) {
      checks.push(
        check(
          'target-lock',
          'warn',
          'a live Chrome is holding the target profile — quit it (Cmd-Q) and re-run. The graft was NOT applied.',
        ),
      )
      return { checks, grafted: false, skipped: true }
    }
    checks.push(check('target-lock', 'pass', 'no live holder'))
  }

  // 9. Freshness: a matching state file means the graft is current. A
  // manifest FILE's presence is part of "current" — it joined the graft file
  // set later, and an older graft without it has a silently dead desktop-app
  // bridge. Chrome creates the NativeMessagingHosts dir empty at first
  // launch, so the directory's existence alone proves nothing.
  // oxlint-disable-next-line socket/prefer-exists-sync -- needs mtimeMs
  const sourceStat = await fs.stat(source.dir)
  const prior = await readGraftState(targetProfileDir)
  if (
    prior !== undefined &&
    prior.sourceExtensionMtimeMs === sourceStat.mtimeMs &&
    profileHasOnePassword(targetProfileDir) &&
    existsSync(
      path.join(
        targetProfileDir,
        'NativeMessagingHosts',
        NATIVE_MESSAGING_MANIFESTS[0]!,
      ),
    )
  ) {
    checks.push(
      check(
        'freshness',
        'pass',
        `graft is current (source version ${prior.sourceVersion}).`,
      ),
    )
    return { checks, grafted: true, skipped: false }
  }
  checks.push(
    check(
      'freshness',
      'warn',
      prior === undefined
        ? 'no prior graft — copying now.'
        : `source extension changed since the prior graft (${prior.sourceVersion}) — re-grafting.`,
    ),
  )

  if (dryRun) {
    checks.push(check('dry-run', 'pass', 'no files copied (--describe).'))
    return { checks, grafted: false, skipped: true }
  }

  // The graft itself. Secure Preferences + Local State first: they carry the
  // registration. The extension-data dirs follow, best-effort.
  await fs.mkdir(path.join(targetProfileDir, 'Default'), { recursive: true })
  await copyIfPresent(
    path.join(sourceUserDataDir, 'Default', 'Secure Preferences'),
    path.join(targetProfileDir, 'Default', 'Secure Preferences'),
  )
  await copyIfPresent(
    path.join(sourceUserDataDir, 'Local State'),
    path.join(targetProfileDir, 'Local State'),
  )
  // The native messaging host manifests live at the USER-DATA-DIR level, not
  // inside any profile — a fresh target user-data-dir has no
  // NativeMessagingHosts at all, so without this copy Chrome never learns
  // com.1password.1password exists and the desktop-app bridge silently never
  // forms (observed 2026-08-15: extension enabled, zero BrowserSupport
  // processes spawned).
  const targetManifestDir = path.join(targetProfileDir, 'NativeMessagingHosts')
  await fs.mkdir(targetManifestDir, { recursive: true })
  for (let i = 0, { length } = NATIVE_MESSAGING_MANIFESTS; i < length; i += 1) {
    const name = NATIVE_MESSAGING_MANIFESTS[i]!
    // Sequential: two tiny files.
    // eslint-disable-next-line no-await-in-loop -- two tiny copies
    await copyIfPresent(
      path.join(manifestDir, name),
      path.join(targetManifestDir, name),
    )
  }
  // Clear older grafted versions before copying the current one, so Chrome
  // never sees two version dirs of the same extension.
  const targetExtensionsDir = path.join(
    targetProfileDir,
    'Default',
    'Extensions',
    id,
  )
  safeDeleteSync(targetExtensionsDir)
  await copyDirRecursive(
    source.dir,
    path.join(targetExtensionsDir, source.version),
  )
  await copyIfPresent(
    path.join(sourceUserDataDir, 'Default', 'Local Extension Settings', id),
    path.join(targetProfileDir, 'Default', 'Local Extension Settings', id),
  )
  await copyIfPresent(
    path.join(sourceUserDataDir, 'Default', 'Sync Extension Settings', id),
    path.join(targetProfileDir, 'Default', 'Sync Extension Settings', id),
  )
  // IndexedDB dirs are suffixed per-instance (`_0.indexeddb.leveldb`, …).
  const idbPrefix = `chrome-extension_${id}_`
  const sourceIdbDir = path.join(sourceUserDataDir, 'Default', 'IndexedDB')
  try {
    const idbEntries = await fs.readdir(sourceIdbDir)
    for (let i = 0, { length } = idbEntries; i < length; i += 1) {
      const entry = idbEntries[i]!
      if (entry.startsWith(idbPrefix)) {
        // Sequential: a handful of small dirs.
        // eslint-disable-next-line no-await-in-loop -- few tiny copies
        await copyIfPresent(
          path.join(sourceIdbDir, entry),
          path.join(targetProfileDir, 'Default', 'IndexedDB', entry),
        )
      }
    }
  } catch {
    // No IndexedDB dir at all — a fresh source profile; nothing to copy.
  }

  const state: GraftStateFile = {
    __proto__: null,
    graftedAt: new Date().toISOString(),
    sourceExtensionMtimeMs: sourceStat.mtimeMs,
    sourceProfile: sourceUserDataDir,
    sourceVersion: source.version,
  } as GraftStateFile
  await fs.writeFile(
    path.join(targetProfileDir, GRAFT_STATE_FILE),
    JSON.stringify(state, undefined, 2),
  )
  logger.log(`Grafted 1Password ${source.version} into ${targetProfileDir}.`)
  checks.push(check('graft', 'pass', `copied version ${source.version}`))
  return { checks, grafted: true, skipped: false }
}
