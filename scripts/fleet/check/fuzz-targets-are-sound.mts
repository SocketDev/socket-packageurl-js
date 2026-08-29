#!/usr/bin/env node
/**
 * @file Assertion: a repo's Rust fuzz targets are in a state worth fuzzing —
 *   no `unsafe` without a `// FUZZ:` annotation, and a `fuzz/Cargo.lock` that
 *   matches the dependency graph.
 *   NEITHER of these runs a fuzzer. That is the whole reason they live in a
 *   check rather than in the fuzz workflow: fuzzing moved to a weekly schedule
 *   because a wall-clock-budgeted campaign cannot gate a commit, and these two
 *   got carried along with it. They are seconds of static reading, so a broken
 *   target or a stale lockfile should fail the PR that introduced it instead of
 *   surfacing up to a week later in a run nobody is watching.
 *   ONE implementation, two callers: the weekly fuzz workflow invokes this same
 *   script before spending ten minutes per target, so the campaign and the
 *   per-PR gate cannot drift into disagreeing about what "sound" means.
 *   Skips CLEANLY — never false-green — in a repo with no `fuzz/Cargo.toml`
 *   (the cargo-fuzz marker), and reports the gap loudly rather than passing
 *   when the toolchain needed to answer is absent.
 *   Usage: node scripts/fleet/check/fuzz-targets-are-sound.mts [--json]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * The cargo-fuzz marker: a repo fuzzes Rust when it carries this manifest.
 */
export const FUZZ_MANIFEST = path.join('fuzz', 'Cargo.toml')

/**
 * The lint every Rust fuzz repo is contracted to ship.
 */
export const NO_UNSAFE_SCRIPT = path.join('fuzz', 'no-unsafe-without-fuzz.sh')

export interface SoundnessInputs {
  readonly hasCargo: boolean
  readonly hasFuzzManifest: boolean
  readonly hasNoUnsafeScript: boolean
}

export type SoundnessStep = 'cargo-lock' | 'no-unsafe'

export interface SoundnessPlan {
  readonly gaps: readonly string[]
  readonly skipReason?: string | undefined
  readonly steps: readonly SoundnessStep[]
}

/**
 * What to run, what to report as a gap, and whether to skip outright. Pure over
 * the three filesystem facts, so the decision is testable without a Rust
 * toolchain or a fuzz directory.
 *
 * A missing `no-unsafe-without-fuzz.sh` is a GAP, not a silent pass: the repo
 * contract requires it, and treating its absence as "nothing to check" is how a
 * fuzz repo ends up with unannotated `unsafe` and a green gate.
 *
 * A missing cargo is NOT a gap. The check has to stay honest on a machine that
 * cannot answer the question — a hook-only member, or a JS contributor's laptop
 * — so it says the step was skipped rather than inventing a verdict.
 */
export function planSoundness(inputs: SoundnessInputs): SoundnessPlan {
  const facts = { __proto__: null, ...inputs } as SoundnessInputs
  if (!facts.hasFuzzManifest) {
    return {
      gaps: [],
      skipReason: `no ${FUZZ_MANIFEST} — this repo does not fuzz Rust.`,
      steps: [],
    }
  }
  const gaps: string[] = []
  const steps: SoundnessStep[] = []
  if (facts.hasNoUnsafeScript) {
    steps.push('no-unsafe')
  } else {
    gaps.push(
      `${FUZZ_MANIFEST} exists but ${NO_UNSAFE_SCRIPT} does not — the Rust fuzz contract requires it.`,
    )
  }
  if (facts.hasCargo) {
    steps.push('cargo-lock')
  }
  return { gaps, steps }
}

/**
 * True when a `cargo` executable is on PATH.
 */
export function cargoAvailable(repoRoot: string): boolean {
  return (
    spawnSync('cargo', ['--version'], { cwd: repoRoot, stdioString: true })
      .status === 0
  )
}

/**
 * Read the repo's soundness facts from disk.
 */
export function readInputs(repoRoot: string): SoundnessInputs {
  const hasFuzzManifest = existsSync(path.join(repoRoot, FUZZ_MANIFEST))
  return {
    // Probed only when it is going to be used — spawning `cargo --version` in
    // every repo that does not fuzz is a cost the answer cannot change.
    hasCargo: hasFuzzManifest ? cargoAvailable(repoRoot) : false,
    hasFuzzManifest,
    hasNoUnsafeScript: existsSync(path.join(repoRoot, NO_UNSAFE_SCRIPT)),
  }
}

function runStep(step: SoundnessStep, repoRoot: string): string | undefined {
  const result =
    step === 'no-unsafe'
      ? spawnSync('bash', [NO_UNSAFE_SCRIPT], {
          cwd: repoRoot,
          stdioString: true,
        })
      : spawnSync(
          'cargo',
          [
            'metadata',
            '--manifest-path',
            FUZZ_MANIFEST,
            '--locked',
            '--format-version',
            '1',
          ],
          { cwd: repoRoot, stdioString: true },
        )
  if (result.status === 0) {
    return undefined
  }
  const detail = String(result.stderr ?? '').trim() || `exit ${result.status}`
  return step === 'no-unsafe'
    ? `${NO_UNSAFE_SCRIPT} failed: ${detail}`
    : `fuzz/Cargo.lock is out of date with fuzz/Cargo.toml — refresh it so a campaign is reproducible: ${detail}`
}

function main(): number {
  const inputs = readInputs(REPO_ROOT)
  const plan = planSoundness(inputs)
  const failures = [...plan.gaps]
  for (let i = 0, { length } = plan.steps; i < length; i += 1) {
    const failure = runStep(plan.steps[i]!, REPO_ROOT)
    if (failure) {
      failures.push(failure)
    }
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ failures, plan }, undefined, 2)}\n`,
    )
    return failures.length === 0 ? 0 : 1
  }
  if (plan.skipReason) {
    logger.log(`fuzz-targets-are-sound: skipped (${plan.skipReason})`)
    return 0
  }
  if (failures.length === 0) {
    logger.success(
      `[fuzz-targets-are-sound] Rust fuzz targets are sound (${plan.steps.length} check(s) ran).`,
    )
    if (!inputs.hasCargo) {
      logger.log(
        '  note: cargo is not on PATH, so the fuzz/Cargo.lock freshness check did not run here (CI runs it).',
      )
    }
    return 0
  }
  for (let i = 0, { length } = failures; i < length; i += 1) {
    logger.fail(`[fuzz-targets-are-sound] ${failures[i]!}`)
  }
  logger.error(
    'Wanted: fuzz targets that build from a locked dependency graph, with ' +
      'every `unsafe` annotated. Fix: address the failures above — neither ' +
      'check runs a fuzzer, so both are reproducible locally.',
  )
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks Rust fuzz targets carry annotated unsafe and a fresh fuzz/Cargo.lock',
  help: `Usage: node scripts/fleet/check/fuzz-targets-are-sound.mts [flags]
  --json   print the failures and the plan as JSON`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(() => {
    process.exitCode = main()
  }, SCRIPT_META)
}
/* c8 ignore stop */
