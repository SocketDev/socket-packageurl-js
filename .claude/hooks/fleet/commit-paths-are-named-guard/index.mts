#!/usr/bin/env node
/*
 * @file Claude Code PreToolUse hook - commit-paths-are-named-guard.
 *
 * commit-paths exists for one reason: a commit carries only the paths you
 * NAMED, through an isolated index, so a parallel session's staged work cannot
 * ride along. Feeding it a computed path list defeats that entirely - it
 * becomes `git add -A` with extra steps, and the commit message then describes
 * one change while the commit carries three.
 *
 * That is not hypothetical. A commit landed on wheelhouse main labelled
 * "dogfood artifact-gates-on-stop" carrying another session's .gitmodules
 * submodule work and an unrelated comment edit, because the invocation was
 * `commit-paths -m "..." $(git status --porcelain | awk '{print $NF}')`.
 *
 * So: a substitution that WALKS THE TREE is refused. A substitution that
 * produces a message (`-F`, or `-m "$(cat notes)"`) is fine, which is why the
 * detector looks for the enumerating command rather than for `$(` alone.
 */

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'

/**
 * Commands that enumerate the working tree. A path list built from any of these
 * is the whole dirty set, not a set someone chose.
 */
const TREE_WALKERS =
  /\bgit\s+(?:diff|ls-files|status)\b|\bfind\s|\bls\s|\bxargs\b/

/**
 * Whether `command` invokes commit-paths at all.
 */
export function invokesCommitPaths(command: string): boolean {
  return /\bcommit-paths(?:\.mts)?\b/.test(command)
}

/**
 * The substitution spans in `command`: `$(...)` and backticked runs.
 *
 * Nesting is not tracked. A nested substitution still contains its inner text
 * inside the outer span, so a tree walker anywhere in it is still seen.
 */
export function substitutionSpans(command: string): string[] {
  const spans: string[] = []
  const dollar = /\$\(([^)]*)\)/g
  let hit = dollar.exec(command)
  while (hit) {
    spans.push(hit[1]!)
    hit = dollar.exec(command)
  }
  const backtick = /`([^`]*)`/g
  hit = backtick.exec(command)
  while (hit) {
    spans.push(hit[1]!)
    hit = backtick.exec(command)
  }
  return spans
}

/**
 * The tree-walking command feeding a commit-paths path list, or undefined when
 * the invocation names its paths.
 */
export function computedPathListReason(command: string): string | undefined {
  if (!invokesCommitPaths(command)) {
    return undefined
  }
  // A pipe INTO commit-paths is the same sweep by another route.
  if (/\|\s*(?:\S*\s+)*?xargs\b[^|]*commit-paths/.test(command)) {
    return 'a pipe into xargs'
  }
  const spans = substitutionSpans(command)
  for (let i = 0, { length } = spans; i < length; i += 1) {
    const span = spans[i]!
    const walker = TREE_WALKERS.exec(span)
    if (walker) {
      return `\`${walker[0].trim()}\``
    }
  }
  return undefined
}

export const hook = defineHook({
  check: bashGuard((command): GuardResult => {
    const reason = computedPathListReason(command)
    if (!reason) {
      return undefined
    }
    return block(
      `commit-paths-are-named-guard: the path list comes from ${reason}, so this commits the whole dirty set - which is what commit-paths exists to prevent.\n` +
        `Where: a computed path list defeats the isolated index and sweeps a parallel session's work into your message.\n` +
        `Fix: name the paths you changed, e.g. \`node scripts/fleet/commit-paths.mts -m "…" path/one path/two\`.`,
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
