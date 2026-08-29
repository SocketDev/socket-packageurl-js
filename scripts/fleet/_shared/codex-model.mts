/**
 * @file Which model the Codex seat is configured to run. WHY IT IS READ RATHER
 *   THAN COUNTED. Every other gauge learns its model from OpenCode's database,
 *   because OpenCode is what ran it. Codex is reached by its own CLI and leaves
 *   no row there, so the model has to come from the place that decides it:
 *   Codex's own config. A TINY PARSER, NOT A TOML LIBRARY. One key off the top
 *   level of a file this does not own. Pulling in a TOML dependency to read one
 *   line would be a supply-chain surface for a statusline label, and a
 *   line-scan that only accepts a top-level `model = "..."` cannot be confused
 *   by a nested table's key of the same name. ABSENT IS ORDINARY. A machine
 *   with no Codex config is not an error, so this resolves to undefined and the
 *   gauge falls back to naming the seat.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { CODEX_HOME } from '../paths.mts'

/**
 * The models the Codex seat can be pointed at, in the order the caret steps
 * through them.
 *
 * A hardcoded list because Codex authenticates against a ChatGPT seat rather
 * than an API key, so there is no `/models` endpoint to ask - the other two
 * providers get their list live and this one cannot.
 */
export const CODEX_MODELS = ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5'] as const

/**
 * Codex's config file.
 */
export function codexConfigPath(home: string = CODEX_HOME): string {
  return path.join(home, 'config.toml')
}

/**
 * The top-level `model` value, or undefined when the file does not set one.
 *
 * Stops at the first table header, so a `model` key inside `[some.table]` is
 * never mistaken for the seat's own setting. Both quote styles are accepted
 * because TOML allows either.
 */
export function parseCodexModel(toml: string): string | undefined {
  const lines = toml.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (line.startsWith('[')) {
      // A table header ends the top-level section this reads.
      return undefined
    }
    const match = /^model\s*=\s*(?<quote>["'])(?<model>[^"']+)\k<quote>/.exec(
      line,
    )
    if (match?.groups) {
      return match.groups['model']
    }
  }
  return undefined
}

/**
 * The model the Codex seat runs, or undefined when nothing configures one.
 */
export function readCodexModel(
  target: string = codexConfigPath(),
): string | undefined {
  try {
    return parseCodexModel(readFileSync(target, 'utf8'))
  } catch {
    // No config, no read permission. Both mean the gauge names the seat instead.
    return undefined
  }
}

/*
 * The top-level `model` assignment. Anchored to the start of a line with no
 * leading whitespace, which is what keeps it top-level: a key inside a table is
 * indented, and anything after the first `[` header belongs to that table.
 */
const CODEX_MODEL_KEY_RE =
  /^(?<lead>model\s*=\s*(?<quote>["']))(?<model>[^"']*)\k<quote>/m

/**
 * Replace the top-level `model` value, leaving every other byte as it was.
 * Undefined when there is no top-level key to replace.
 *
 * A targeted splice rather than a parse-and-reserialise, for the same reason
 * the reader is a line scan: this file belongs to Codex, it carries MCP server
 * wiring and per-project state, and a TOML round-trip would reformat all of it
 * to change one string. Adding a key that is absent is deliberately NOT done -
 * that means guessing placement in a document with tables, where a key written
 * below the first `[header]` silently lands inside that table.
 */
export function withCodexModel(
  toml: string,
  model: string,
): string | undefined {
  const head = toml.split(/^\[/m)[0] ?? ''
  if (!CODEX_MODEL_KEY_RE.test(head)) {
    return undefined
  }
  // Spliced within the pre-table head, so a `model` key inside a later table
  // cannot be the one rewritten.
  const patchedHead = head.replace(CODEX_MODEL_KEY_RE, (...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string>
    return `${groups['lead']}${model}${groups['quote']}`
  })
  return `${patchedHead}${toml.slice(head.length)}`
}

/**
 * Point the Codex seat at a model. True when the file was changed.
 *
 * Written to a scratch sibling and renamed, so a crash never leaves the
 * operator with a truncated Codex config.
 */
export function writeCodexModel(
  model: string,
  target: string = codexConfigPath(),
): boolean {
  let current: string
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    return false
  }
  const next = withCodexModel(current, model)
  if (next === undefined || next === current) {
    return false
  }
  try {
    const scratch = `${target}.${process.pid}.tmp`
    writeFileSync(scratch, next, { encoding: 'utf8', mode: 0o600 })
    renameSync(scratch, target)
    return true
  } catch {
    return false
  }
}
