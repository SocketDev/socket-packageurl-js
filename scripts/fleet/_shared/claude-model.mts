/**
 * @file Which model Claude Code is configured to run, and how to change it.
 *   A TARGETED KEY EDIT, NOT A REWRITE. This file belongs to the client, not to
 *   the fleet, and it carries permissions, hook wiring, and plugin state that
 *   matter more than the one key being touched. Parsing and re-serialising the
 *   whole document would reformat every line and drop anything `JSON.parse`
 *   does not model, so the write replaces exactly the `model` value and leaves
 *   every other byte alone.
 *   TOP LEVEL ONLY. The key is matched at the root object's indent, so a
 *   `model` inside a nested object is never mistaken for the client's own
 *   setting - the same rule the Codex reader beside this one follows.
 *   THE RUNNING SESSION IS NOT AFFECTED, AND THAT IS NOT A BUG. Claude Code
 *   reads this at startup and `/model` overrides it for the session in flight,
 *   so a change here is what the NEXT session opens with. The statusline keeps
 *   naming the model actually running, because that is the true answer to what
 *   is being billed right now.
 *   ABSENT IS ORDINARY. No settings file, or no `model` key in one, means the
 *   client is on its own default; that resolves to undefined rather than an
 *   error.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { CLAUDE_HOME } from '../paths.mts'

/**
 * The models Claude Code accepts in its `model` setting, in the order the caret
 * steps through them: most capable first, descending.
 *
 * Aliases rather than dated ids. The client resolves `opus` to whichever Opus
 * is current, so a pinned id here would go stale on the next release and a
 * caret would eventually cycle onto a model that no longer exists.
 */
export const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku', 'fable'] as const

/**
 * Claude Code's settings file.
 */
export function claudeSettingsPath(home: string = CLAUDE_HOME): string {
  return path.join(home || CLAUDE_HOME, 'settings.json')
}

/*
 * The root object's `model` key. Two-space indent anchors it to the top level:
 * anything nested sits at four or more, so a `model` key inside another object
 * cannot match. `m` rather than a full parse so the write can be a splice.
 */
const CLAUDE_MODEL_KEY_RE =
  /^(?<lead> {2}"model"\s*:\s*")(?<model>[^"]*)(?<tail>")/m

/**
 * The configured model, or undefined when the document does not set one.
 */
export function parseClaudeModel(json: string): string | undefined {
  const match = CLAUDE_MODEL_KEY_RE.exec(json)
  const model = match?.groups?.['model']
  return model ? model : undefined
}

/**
 * The model Claude Code is configured to open with, or undefined.
 */
export function readClaudeModel(
  target: string = claudeSettingsPath(),
): string | undefined {
  try {
    return parseClaudeModel(readFileSync(target, 'utf8'))
  } catch {
    // No settings file, or no read permission. Both mean the client default.
    return undefined
  }
}

/**
 * Replace the `model` value in a settings document, leaving every other byte
 * as it was. Undefined when the document has no top-level `model` key to
 * replace.
 *
 * Returning undefined rather than INSERTING one is deliberate: adding a key to
 * a file this does not own means guessing where it goes and how the document is
 * punctuated, and a malformed settings file costs the operator their whole
 * client config. A machine with no `model` key keeps the client default, which
 * is a working state.
 */
export function withClaudeModel(
  json: string,
  model: string,
): string | undefined {
  if (!CLAUDE_MODEL_KEY_RE.test(json)) {
    return undefined
  }
  return json.replace(CLAUDE_MODEL_KEY_RE, (...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string>
    return `${groups['lead']}${model}${groups['tail']}`
  })
}

/**
 * Point Claude Code at a model. True when the file was changed.
 *
 * Written to a scratch sibling and renamed, so a crash or a concurrent reader
 * never sees a half-written settings file - the one failure mode that would
 * cost more than the feature is worth.
 */
export function writeClaudeModel(
  model: string,
  target: string = claudeSettingsPath(),
): boolean {
  let current: string
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    return false
  }
  const next = withClaudeModel(current, model)
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
