/*
 * @file Fleet-canonical Homebrew publish runner — the brew channel beside
 *   npm-publish.mts / cargo-publish.mts / go-publish.mts. A Homebrew formula
 *   is like a Go module tag: there is NO registry upload and NO publish
 *   token. The artifact already exists (the GitHub release's binaries); the
 *   formula is just a pointer at them — a Ruby file with urls + sha256s. So
 *   "publish" here is two steps:
 *
 *     1. RENDER — Formula/<name>.rb from the tag + per-platform sha256s
 *        (pure; see registry-infra/brew/shared.mts). Emitted to stdout in a
 *        dry run so the release workflow can attach it to the GitHub release
 *        as an asset — `brew install <file-or-url>` works with no tap at all.
 *     2. TAP (--apply --tap owner/repo) — clone the tap, write the formula,
 *        signed-commit, push. The tap IS the distribution; pushing to it is
 *        the publish, the same way pushing the semver tag is go-publish's.
 *
 *   There is deliberately NO stage/approve/OTP split: a formula update is a
 *   content-addressed pointer at immutable release assets — if the assets
 *   moved, the old sha256s fail loudly on `brew install`, which is the only
 *   verify that matters. (The release-before-formula order is what makes the
 *   assets immutable first; never point a formula at a tag that hasn't cut.)
 *
 *   DRY-RUN by default, `--apply` to act — matching the other channels'
 *   ergonomics. The tap push uses the operator's existing git credentials;
 *   rendering needs none.
 *
 *   Usage: node scripts/fleet/brew-publish.mts --name sfw --tag v1.2.3 \
 *     --release-repo SocketDev/sfw-free \
 *     --sha macos-arm=<sha> --sha macos-intel=<sha> [--tap owner/repo] [--apply]
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  parseAssetChecksums,
  renderFormula,
} from './registry-infra/brew/shared.mts'
import type { FormulaSpec } from './registry-infra/brew/shared.mts'
import { assertGhAuth } from './registry-infra/gh-auth.mts'
import { logger } from './registry-infra/shared.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import type { ScriptMeta } from './_shared/run-main.mts'

export { parseAssetChecksums, renderFormula }

interface BrewPublishArgs {
  apply: boolean
  caveats: string | undefined
  desc: string | undefined
  homepage: string | undefined
  license: string | undefined
  name: string
  releaseRepo: string
  shas: string[]
  tag: string
  tap: string | undefined
}

const LICENSE_IDS = new Set(['Apache-2.0', 'MIT', 'PolyForm-Shield-1.0.0'])

function resolveOptions(): BrewPublishArgs {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      apply: { default: false, type: 'boolean' },
      caveats: { type: 'string' },
      desc: { type: 'string' },
      homepage: { type: 'string' },
      license: { default: 'PolyForm-Shield-1.0.0', type: 'string' },
      name: { type: 'string' },
      'release-repo': { type: 'string' },
      sha: { default: [], multiple: true, type: 'string' },
      tag: { type: 'string' },
      tap: { type: 'string' },
    },
  })

  const name = values['name'] as string | undefined
  const tag = values['tag'] as string | undefined
  const releaseRepo = values['release-repo'] as string | undefined
  if (!name || !tag || !releaseRepo) {
    throw new Error('--name, --tag, and --release-repo are required')
  }
  if (!/^v\d+\.\d+\.\d+/.test(tag)) {
    throw new Error(`--tag must look like vX.Y.Z, got "${tag}"`)
  }
  const license = (values['license'] ?? 'PolyForm-Shield-1.0.0') as string
  if (!LICENSE_IDS.has(license)) {
    throw new Error(`--license must be one of ${[...LICENSE_IDS].join(', ')}`)
  }
  const shas = (values['sha'] ?? []) as string[]
  if (shas.length === 0) {
    throw new Error('at least one --sha <platform>=<hex> is required')
  }
  return {
    apply: (values['apply'] ?? false) as boolean,
    caveats: values['caveats'] as string | undefined,
    desc: (values['desc'] ?? `${name} — published by Socket`) as string,
    homepage: (values['homepage'] ?? 'https://socket.dev') as string,
    license,
    name,
    releaseRepo,
    shas,
    tag,
    tap: values['tap'] as string | undefined,
  }
}

export function buildSpec(
  name: string,
  tag: string,
  releaseRepo: string,
  shas: string[],
  options?:
    | {
        caveats?: string | undefined
        desc?: string | undefined
        homepage?: string | undefined
        license?: string | undefined
      }
    | undefined,
): FormulaSpec {
  const opts = { __proto__: null, ...options } as {
    caveats?: string | undefined
    desc?: string | undefined
    homepage?: string | undefined
    license?: string | undefined
  }
  return {
    assets: parseAssetChecksums(name, shas),
    caveats: opts.caveats,
    desc: opts.desc ?? `${name} — published by Socket`,
    homepage: opts.homepage ?? 'https://socket.dev',
    license: opts.license ?? 'PolyForm-Shield-1.0.0',
    name,
    releaseRepo,
    tag,
    version: tag.replace(/^v/, ''),
  }
}

async function publishToTap(
  name: string,
  tag: string,
  tap: string,
  formula: string,
): Promise<void> {
  // The tap push IS the publish — there is no registry on the other side.
  assertGhAuth({ flow: 'brew:publish', requiredScopes: [] })
  const workdir = mkdtempSync(path.join(os.tmpdir(), 'brew-tap-'))
  try {
    await spawn(
      'git',
      ['clone', '--depth', '1', `https://github.com/${tap}.git`, workdir],
      {
        stdio: 'inherit',
      },
    )
    writeFileSync(path.join(workdir, 'Formula', `${name}.rb`), formula)
    await spawn('git', ['add', `Formula/${name}.rb`], {
      cwd: workdir,
      stdio: 'inherit',
    })
    const staged = await spawn('git', ['diff', '--staged', '--name-only'], {
      cwd: workdir,
    })
    if (!String(staged.stdout).trim()) {
      logger.log(`Formula/${name}.rb already current in ${tap}`)
      return
    }
    await spawn('git', ['commit', '-m', `${name} ${tag}`], {
      cwd: workdir,
      stdio: 'inherit',
    })
    await spawn('git', ['push', 'origin', 'main'], {
      cwd: workdir,
      stdio: 'inherit',
    })
    logger.log(`Formula/${name}.rb pushed to ${tap}`)
  } finally {
    safeDeleteSync(workdir)
  }
}

async function main(): Promise<void> {
  const options = resolveOptions()
  const formula = renderFormula(
    buildSpec(options.name, options.tag, options.releaseRepo, options.shas, {
      caveats: options.caveats,
      desc: options.desc,
      homepage: options.homepage,
      license: options.license,
    }),
  )

  if (!options.apply || !options.tap) {
    // Dry run (or tap-free release-asset flow): the formula goes to stdout so
    // a release workflow can attach it to the GitHub release.
    process.stdout.write(formula)
    if (!options.tap) {
      logger.log(
        '(no --tap: emitted only; attach to the release or pass --apply --tap to publish)',
      )
    }
    return
  }

  await publishToTap(options.name, options.tag, options.tap, formula)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'render a Homebrew formula for a release and, with --apply --tap, push it to the tap — the tap push IS the publish',
  help: `Usage: node scripts/fleet/brew-publish.mts --name <formula> --tag vX.Y.Z --release-repo owner/repo --sha <platform>=<hex> [flags]
  --name <formula>        formula/binary name (asset names follow <name>-<os>-<arch>)
  --tag vX.Y.Z            the release tag the assets hang off (must already be cut)
  --release-repo o/r      GitHub project whose releases host the binaries
  --sha <platform>=<hex>  per-platform sha256; platforms: macos-arm macos-intel linux-arm linux-intel. Repeatable
  --tap owner/repo        tap to update (with --apply); omit to emit the formula to stdout only
  --caveats <text>        extra caveats paragraph (e.g. an ad-hoc-signature quarantine note)
  --desc <text>           formula description (default: "<name> — published by Socket")
  --homepage <url>        formula homepage (default: https://socket.dev)
  --license <id>          Apache-2.0 | MIT | PolyForm-Shield-1.0.0 (default)
  --apply                 publish for real (push to the tap); without it the run is a dry run`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
