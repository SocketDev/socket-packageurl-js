/**
 * @file The `git` origin shape: install an external tool whose upstream
 *   ships no release assets, without giving up the integrity pin.
 *   WHY THIS SHAPE EXISTS. Every other tool in `external-tools.json` is
 *   `origin: 'gh-asset'` - a GitHub release asset with a recorded SRI the
 *   installer verifies before running. Some upstreams publish no assets at all
 *   and install by cloning their default branch, which pins nothing: two runs a
 *   day apart install different code and neither can say which.
 *   THE SHA IS THE INTEGRITY. Git objects are content-addressed, so a commit
 *   SHA is exactly as strong a pin as a tarball hash - it names one tree and no
 *   other. The clone is made at a TAG for a shallow fetch, then HEAD is checked
 *   against the recorded SHA. A tag can be moved upstream; the SHA cannot, so
 *   the verification is what does the work and the tag is only how to fetch
 *   cheaply.
 *   IT NEVER RUNS UPSTREAM'S INSTALLER AGAINST UPSTREAM. The point is that the
 *   tool's own install script clones from wherever it is told, so it is pointed
 *   at the LOCAL verified clone instead of the network. Whatever the upstream
 *   default branch is doing at that moment cannot reach the machine.
 *   SHALLOW AND SINGLE-BRANCH, PER FLEET RULE. Both flags, always: a bare clone
 *   missing either is blocked, and neither is optional for a pin that names one
 *   commit.
 */

import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

/**
 * A tool installed by cloning rather than by downloading a release asset.
 */
export interface ClonedToolSpec {
  /**
   * The environment variable the tool's own installer reads to decide WHERE to
   * clone from. Pointing it at the verified local clone is what keeps the
   * install off the network.
   */
  readonly sourceEnvVar: string
  /**
   * The tag to fetch, which makes the clone shallow. Never the pin itself: a
   * tag can be moved upstream.
   */
  readonly ref: string
  readonly repository: string
  /**
   * The commit the tag MUST resolve to. This is the pin.
   */
  readonly sha: string
}

/**
 * The git flags every fleet clone carries.
 */
export const CLONE_FLAGS: readonly string[] = ['--depth=1', '--single-branch']

/**
 * Clone `spec` into `dest` and prove it is the pinned commit.
 *
 * Throws when the tag resolves to anything else, because that is either an
 * upstream that moved a tag or a mirror serving different code - and both are
 * exactly what the pin exists to catch. The failed clone is removed rather than
 * left behind, so a later run cannot mistake it for a verified one.
 */
export async function cloneAtPinnedSha(
  spec: ClonedToolSpec,
  dest: string,
): Promise<void> {
  safeDeleteSync(dest)
  await spawn(
    'git',
    ['clone', ...CLONE_FLAGS, '--branch', spec.ref, spec.repository, dest],
    { stdio: 'ignore' },
  )
  const head = await readHeadSha(dest)
  if (head !== spec.sha) {
    safeDeleteSync(dest)
    throw new Error(
      `Pinned ref does not match for ${spec.repository}. Where: cloneAtPinnedSha (${dest}). Saw HEAD ${head} at tag ${spec.ref}; wanted ${spec.sha}. Fix: an upstream MOVED the tag, or the remote is not the one pinned - re-verify the commit upstream, then update the sha in external-tools.json. Do not relax this check.`,
    )
  }
}

/**
 * The commit a clone is sitting on.
 */
export async function readHeadSha(dir: string): Promise<string> {
  const result = await spawn('git', ['-C', dir, 'rev-parse', 'HEAD'])
  return String(result.stdout).trim()
}

export interface CloneInstallConfig {
  /**
   * Where the verified clone is staged.
   */
  readonly cloneDir: string
  /**
   * The tool's own installer, run with its source pointed at the clone.
   */
  readonly installer: readonly string[]
  readonly spec: ClonedToolSpec
}

/**
 * The environment the tool's installer runs under.
 *
 * Built rather than assembled at the call site so the source override cannot be
 * forgotten - forgetting it is silent, and the installer would go straight to
 * upstream's default branch and install unpinned code that looks identical.
 */
export function installerEnv(
  spec: ClonedToolSpec,
  cloneDir: string,
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...base, [spec.sourceEnvVar]: path.resolve(cloneDir) }
}
