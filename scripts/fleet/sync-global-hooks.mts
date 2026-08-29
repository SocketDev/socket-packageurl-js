#!/usr/bin/env node
/*
 * @file Register every `global: true` fleet hook in the operator's
 *   `~/.claude/settings.json`, so a hook that claims to run everywhere
 *   actually does.
 *
 *   Two registration surfaces exist and they are not interchangeable. A fleet
 *   REPO registers one `dispatch-launcher <Event>` per event and the dispatch
 *   table routes it to all 330 hooks, so nothing per-hook is needed there. The
 *   operator's own settings file is different: it names each hook individually
 *   via `wheelhouse-dispatch.mts <name>`, because outside a fleet repo there is
 *   no launcher and no table to route through. A hook is therefore live in a
 *   foreign checkout only if it is listed there BY NAME.
 *
 *   `global: true` is the hook's own claim that its rule does not depend on the
 *   repo it runs in - a reply-prose ban, a raw-command redirect, a shell
 *   footgun. That claim is silently false while the name is missing from the
 *   operator's settings, and the shape of the failure is the worst kind: the
 *   hook exists, its tests pass, the dispatch table counts it, and it never
 *   runs for the session that needed it. Every session working from a non-fleet
 *   checkout is unguarded, and nothing says so.
 *
 *   Measured when this script was written: 28 hooks declared `global: true` and
 *   27 were registered. The one gap was a hook added minutes earlier, which is
 *   exactly the window this closes - a hook is registered in the same pass that
 *   creates it, not whenever someone next notices.
 *
 *   Additive only. An entry this script does not recognize is left untouched:
 *   the file is the operator's, carries non-fleet hooks, and a sync that pruned
 *   what it did not understand would delete a personal tool.
 *
 *   Usage: node scripts/fleet/sync-global-hooks.mts [--check] [--json]
 *     --check   report drift and exit 1 without writing
 */

import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { collectEligibleHooks } from './_shared/dispatch-scan.mts'
import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

const HOOKS_REL = path.join('template', 'base', '.claude', 'hooks', 'fleet')

/**
 * The operator settings file this syncs.
 */
export interface UserSettingsPathOptions {
  /**
   * Home directory the settings file sits under. For tests, which cannot write
   * the operator's real one.
   */
  home?: string | undefined
}

export function userSettingsPath(
  options?: UserSettingsPathOptions | undefined,
): string {
  const { home = os.homedir() } = {
    __proto__: null,
    ...options,
  } as UserSettingsPathOptions
  return path.join(home, '.claude', 'settings.json')
}

/**
 * The command string that registers one hook by name.
 *
 * Spelled to match the entries already in the file, `~`-relative rather than
 * absolute, so a synced entry is indistinguishable from a hand-written one.
 */
export function dispatchCommandFor(hookName: string): string {
  return `node ~/.claude/hooks/wheelhouse-dispatch.mts ${hookName}`
}

/**
 * Every global hook in the tree, with the events it declares.
 *
 * Delegated to `collectEligibleHooks`, the one module that parses hook sources.
 * Re-deriving the flags here would be a second parser to keep in step with the
 * dispatch table, and the two disagreeing is precisely how a hook ends up
 * counted in one place and missing from the other.
 */
export function collectGlobalHooks(
  hooksDir: string,
): Array<{ events: string[]; name: string }> {
  return collectEligibleHooks(hooksDir)
    .filter(hook => hook.global)
    .map(hook => ({ events: [...hook.events], name: hook.name }))
}

/**
 * The global hooks absent from `settingsJson`.
 *
 * Presence is tested by NAME anywhere in the file rather than per event: an
 * operator may have wired a hook to a narrower matcher on purpose, and moving
 * it would override a deliberate choice.
 */
export function findUnregistered(
  settingsJson: string,
  hooks: ReadonlyArray<{ events: string[]; name: string }>,
): Array<{ events: string[]; name: string }> {
  return hooks.filter(hook => !settingsJson.includes(hook.name))
}

interface SettingsShape {
  hooks?: Record<string, unknown[]> | undefined
  [key: string]: unknown
}

/**
 * Add a registration for `hookName` under `event`. Pure over the parsed
 * settings object; the caller owns reading and writing the file.
 */
export function registerHook(
  settings: SettingsShape,
  event: string,
  hookName: string,
): SettingsShape {
  const hooks = settings.hooks ?? {}
  const groups = (hooks[event] ?? []) as Array<Record<string, unknown>>
  const entry = { type: 'command', command: dispatchCommandFor(hookName) }
  // Append to the first group with no matcher, which is the catch-all lane for
  // that event. A matcher-scoped group targets specific tools, and adding an
  // unrelated hook to one would silently narrow when it fires.
  const catchAll = groups.find(g => g['matcher'] === undefined)
  if (catchAll) {
    const list = (catchAll['hooks'] ?? []) as unknown[]
    catchAll['hooks'] = [...list, entry]
  } else {
    groups.push({ hooks: [entry] })
  }
  hooks[event] = groups
  return { ...settings, hooks }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const checkOnly = argv.includes('--check')
  const asJson = argv.includes('--json')
  const settingsPath = userSettingsPath()
  const hooks = collectGlobalHooks(path.join(REPO_ROOT, HOOKS_REL))
  let raw: string
  try {
    raw = readFileSync(settingsPath, 'utf8')
  } catch {
    logger.warn(
      `sync-global-hooks: no settings at ${settingsPath} - nothing to sync.`,
    )
    return
  }
  const missing = findUnregistered(raw, hooks)
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ global: hooks.length, missing: missing.map(m => m.name) })}\n`,
    )
  }
  if (missing.length === 0) {
    if (!asJson) {
      logger.success(
        `sync-global-hooks: all ${hooks.length} global hook(s) registered.`,
      )
    }
    return
  }
  const unroutable = missing.filter(m => m.events.length === 0)
  if (checkOnly) {
    logger.fail(
      `sync-global-hooks: ${missing.length} global hook(s) not registered in ${settingsPath}: ${missing.map(m => m.name).join(', ')}`,
    )
    logger.info('Fix: node scripts/fleet/sync-global-hooks.mts')
    process.exitCode = 1
    return
  }
  const settings = JSON.parse(raw) as SettingsShape
  let added = 0
  for (const hook of missing) {
    if (hook.events.length === 0) {
      continue
    }
    let next = settings
    for (const event of hook.events) {
      next = registerHook(next, event, hook.name)
    }
    Object.assign(settings, next)
    added += 1
    logger.success(
      `sync-global-hooks: registered ${hook.name} on ${hook.events.join(', ')}`,
    )
  }
  if (added > 0) {
    writeFileSync(
      settingsPath,
      `${JSON.stringify(settings, null, 2)}\n`,
      'utf8',
    )
  }
  for (let i = 0, { length } = unroutable; i < length; i += 1) {
    const hook = unroutable[i]!
    logger.warn(
      `sync-global-hooks: ${hook.name} declares global but no readable \`event:\` - register it by hand.`,
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "registers every global: true fleet hook in the operator's ~/.claude/settings.json",
  help: `Usage: node scripts/fleet/sync-global-hooks.mts [flags]

  --check   report drift and exit 1 without writing
  --json    emit the counts as JSON`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
