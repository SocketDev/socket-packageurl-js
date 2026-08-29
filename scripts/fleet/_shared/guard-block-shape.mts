/*
 * @file The pure analyzer behind
 *   `scripts/fleet/check/guard-blocks-are-pithy.mts`: read a hook's source and
 *   report every block message that breaks the fleet quiet-guards contract.
 *   Nothing here touches the filesystem, git, or the logger; the check owns the
 *   walk and the verdict.
 *
 *   The contract a hook block keeps: at most 3 content lines plus an optional
 *   trailing bypass line, the first line opening `<hook-name>: <what> - <why>`,
 *   the last line naming one `Fix:`, and no blank-line padding, no indented
 *   prose paragraph, no multi-command tutorial, no em-dash.
 *
 *   Why a static scan rather than running each hook: a hook emits its block
 *   from a `formatBlock`-style function whose inputs are a live tool payload, so
 *   exercising every branch means constructing every payload shape. The block
 *   text itself is a literal array in the source, and reading that array is what
 *   the sweep reviewer does by hand. This module does the same read.
 *
 *   Detection is scoped to the array-join shape every fleet hook uses:
 *   `[line, line, line].join('\n')`. An array carrying no `Fix:`, `Saw:`,
 *   `Where:` or legacy `Blocked:` line is not a block, so a list of patterns or
 *   paths in the same file is never a finding.
 */

// A block line carries interpolation source rather than rendered text, so the
// budget is measured on the literal and left generous: a `${detail}` costs more
// characters here than it renders.
export const MAX_BLOCK_LINE_LENGTH = 240

// Content lines, so the trailing bypass line does not count against the cap.
export const MAX_BLOCK_CONTENT_LINES = 3

export const EM_DASH = '\u2014'

export type GuardBlockFindingKind =
  | 'em-dash'
  | 'interior-padding'
  | 'legacy-prefix'
  | 'line-too-long'
  | 'missing-fix'
  | 'too-many-lines'
  | 'unnamed-first-line'

export interface GuardBlockFinding {
  readonly detail: string
  readonly kind: GuardBlockFindingKind
  readonly line: number
}

// The tail that makes an array a block: `].join('\n')`. The array BOUNDS come
// from the masked source, so the brackets a retired `[hook-name] Blocked:`
// prefix puts inside a string are never read as array punctuation.
const JOIN_TAIL_RE = /^\s*\.join\('\\n'\)/

// `[hook-name] …`, the retired prefix, with or without the old `Blocked:`
// banner word. The framework already prints the glyph and the hook name, so the
// bracket repeats itself; the shape a swept hook uses is `hook-name: …`.
const LEGACY_PREFIX_RE = /^[`'"]?(?:ℹ️?|⚠️|💡|🚨)?\s*\[[a-z0-9-]+]\s/

// The trailing line naming the bypass phrase. It sits outside the content cap
// because the phrase has to be quoted verbatim.
const BYPASS_RE = /Allow\s|Bypass\s?\(|bypassLine|BYPASS/

// A block line has to be one of these to make the array a block at all.
const BLOCK_MARKER_RE = /Fix:|Saw:|Where:|Blocked:|Bypass/

const FIX_RE = /^[`'"]?Fix:/

// A spread element contributes a data list at runtime, one entry per offending
// path, so its length is the finding count rather than prose the sweep can cut.
const SPREAD_RE = /^\.\.\./

// A hook that keeps its name in a constant interpolates it, so the literal
// carries `${NAME}:` rather than the name itself.
const NAME_HOLE_RE = /\$\{[\w$]*(?:NAME|Name)[\w$]*\}:/

/**
 * `verdictLine(<kind>, <name>, …)` - the sanctioned composer, which prepends
 * the glyph and `<name>: ` itself. The literal therefore never contains
 * `<hook-name>:`, so the naming test reads the second argument instead. A name
 * passed as an identifier (the `NAME` constant a Stop hook uses) counts too.
 */
const VERDICT_LINE_NAME_RE =
  /^verdictLine\(\s*'[a-z]+'\s*,\s*(?:'([a-z0-9-]+)'|([\w$]+))/

// A line that is nothing but one interpolation, so its text lives elsewhere.
const WHOLE_HOLE_RE = /^\$\{[^{}]*\}$/

// The labelled content lines, which a bypass mention never demotes.
const LABELLED_LINE_RE = /^[`'"]?(?:Fix|Saw|Where):/

/**
 * Whether `entry` is the trailing bypass line rather than a content line.
 *
 * A `Fix:` line often names the bypass phrase as the last resort it offers, so
 * the labelled lines win: a line opening `Fix:`, `Saw:` or `Where:` is content
 * whatever else it mentions.
 */
export function isBypassLine(entry: string): boolean {
  if (LABELLED_LINE_RE.test(entry)) {
    return false
  }
  return BYPASS_RE.test(entry)
}

/**
 * Whether `entry` is an empty string element, the spacer a verbose block puts
 * between its paragraphs.
 */
export function isBlankPadding(entry: string): boolean {
  const inner = entry.replace(/^[`'"]|[`'"]$/g, '').trim()
  return inner.length === 0
}

/**
 * Split a matched array body into its element literals, in source order.
 *
 * A template literal can carry a comma inside `${…}`, so the split tracks
 * quote and brace depth rather than cutting on every comma.
 */
export function splitBlockEntries(body: string): string[] {
  const entries: string[] = []
  let current = ''
  let quote = ''
  let braces = 0
  // Call and bracket nesting. An entry is one ELEMENT of the joined array, and
  // `verdictLine('block', name, msg)` carries commas of its own - splitting on
  // those turns a single rendered line into three entries, so the line count
  // and the first-line naming test both read the wrong thing.
  let depth = 0
  for (let i = 0, { length } = body; i < length; i += 1) {
    const char = body[i]!
    if (quote) {
      current += char
      if (char === '\\') {
        current += body[i + 1] ?? ''
        i += 1
        continue
      }
      if (char === '{' && quote === '`' && body[i - 1] === '$') {
        braces += 1
        continue
      }
      if (char === '}' && braces > 0) {
        braces -= 1
        continue
      }
      if (char === quote && braces === 0) {
        quote = ''
      }
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1
      current += char
      continue
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      current += char
      continue
    }
    if (char === ',' && depth === 0) {
      entries.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim().length) {
    entries.push(current.trim())
  }
  return entries.filter(entry => entry.length > 0)
}

// The characters a `/` can follow and still open a regex literal rather than
// divide. A division follows a value, so an identifier, a number, or a closing
// bracket rules the regex reading out.
const REGEX_LEAD_CHARS = new Set([
  ',',
  ';',
  ':',
  '!',
  '?',
  '(',
  '[',
  '{',
  '*',
  '&',
  '%',
  '^',
  '+',
  '<',
  '=',
  '>',
  '|',
  '~',
])

const WHITESPACE_CHARS = new Set(['\t', '\n', '\r', ' '])

/**
 * Whether the `/` at `index` opens a regex literal.
 */
export function startsRegex(source: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    const char = source[i]!
    if (WHITESPACE_CHARS.has(char)) {
      continue
    }
    return REGEX_LEAD_CHARS.has(char)
  }
  return true
}

/**
 * Blank the regex literal starting at `index` in `out`, and return the index
 * just past its closing delimiter and flags.
 */
export function maskRegex(
  source: string,
  out: string[],
  index: number,
): number {
  let i = index + 1
  let inClass = false
  const { length } = source
  while (i < length) {
    const char = source[i]!
    if (char === '\n') {
      return i
    }
    out[i] = ' '
    if (char === '\\') {
      out[i + 1] = ' '
      i += 2
      continue
    }
    if (char === '[') {
      inClass = true
    } else if (char === ']') {
      inClass = false
    } else if (char === '/' && !inClass) {
      i += 1
      break
    }
    i += 1
  }
  while (i < length && /[a-z]/.test(source[i]!)) {
    out[i] = ' '
    i += 1
  }
  return i
}

/**
 * A same-length copy of `source` with every string literal body, regex literal,
 * and comment body blanked out, so a bracket inside quoted text, a pattern, or
 * a comment cannot be read as array punctuation. Interpolation holes keep their
 * contents, since those are code.
 *
 * Same length is the point: an index found in the mask addresses the same
 * character in the original.
 */
export function maskStringContents(source: string): string {
  const out = source.split('')
  // 'code' frames count braces so a `${…}` hole knows which `}` closes it.
  const frames: Array<{ brace: number; mode: string }> = [
    { brace: 0, mode: 'code' },
  ]
  let i = 0
  const { length } = source
  while (i < length) {
    const frame = frames[frames.length - 1]!
    const char = source[i]!
    if (frame.mode === 'code') {
      if (char === '/' && source[i + 1] === '/') {
        while (i < length && source[i] !== '\n') {
          out[i] = ' '
          i += 1
        }
        continue
      }
      if (char === '/' && source[i + 1] === '*') {
        while (i < length && !(source[i] === '*' && source[i + 1] === '/')) {
          out[i] = source[i] === '\n' ? '\n' : ' '
          i += 1
        }
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
        continue
      }
      if (char === "'" || char === '"' || char === '`') {
        frames.push({ brace: 0, mode: char })
        i += 1
        continue
      }
      // A regex literal carries brackets and quotes that are neither: without
      // this arm, the `[^\s'"]` in one pattern opens a bracket that never
      // closes and every array after it reads wrong.
      if (char === '/' && startsRegex(source, i)) {
        i = maskRegex(source, out, i)
        continue
      }
      if (char === '{') {
        frame.brace += 1
        i += 1
        continue
      }
      if (char === '}') {
        if (frame.brace === 0 && frames.length > 1) {
          frames.pop()
          i += 1
          continue
        }
        frame.brace -= 1
        i += 1
        continue
      }
      i += 1
      continue
    }
    // Inside a string literal: blank the body, keep newlines so line numbers
    // survive, and step into an interpolation hole as code.
    if (char === '\\') {
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      continue
    }
    if (char === frame.mode) {
      frames.pop()
      i += 1
      continue
    }
    if (frame.mode === '`' && char === '$' && source[i + 1] === '{') {
      frames.push({ brace: 0, mode: 'code' })
      i += 2
      continue
    }
    if (char !== '\n') {
      out[i] = ' '
    }
    i += 1
  }
  return out.join('')
}

export interface JoinedArray {
  readonly body: string
  readonly index: number
}

/**
 * Every `[ … ].join('\n')` array in `source`, with its body sliced from the
 * original text and its index pointing at the opening bracket.
 */
export function findJoinedArrays(source: string): JoinedArray[] {
  const masked = maskStringContents(source)
  const found: JoinedArray[] = []
  const stack: number[] = []
  for (let i = 0, { length } = masked; i < length; i += 1) {
    const char = masked[i]
    if (char === '[') {
      stack.push(i)
      continue
    }
    if (char !== ']') {
      continue
    }
    const start = stack.pop()
    if (start === undefined) {
      continue
    }
    // The tail is read from the original text: masking blanks the `'\n'`
    // argument, and the argument is what identifies a join.
    if (JOIN_TAIL_RE.test(source.slice(i + 1, i + 24))) {
      found.push({ body: source.slice(start + 1, i), index: start })
    }
  }
  return found
}

export interface SingleStringMessage {
  readonly index: number
  readonly text: string
}

// The verdict builders a hook hands a finished message to.
const VERDICT_CALL_RE = /\b(?:block|notify)\(\s*$/

/**
 * Every `block('…')` / `notify(\`…\`)` in `source` whose argument is one string
 * literal rather than a joined array, with the literal body and its index.
 *
 * This is the other half of the block surface. A hook that emits its verdict as
 * one long template literal is invisible to `findJoinedArrays`, which is how a
 * retired `[hook-name] …` prefix survived a sweep of the array shape.
 */
export function findSingleStringMessages(
  source: string,
): SingleStringMessage[] {
  const masked = maskStringContents(source)
  const found: SingleStringMessage[] = []
  for (let i = 0, { length } = source; i < length; i += 1) {
    const char = source[i]
    if (char !== "'" && char !== '"' && char !== '`') {
      continue
    }
    // A quote the mask kept is a real delimiter; one it blanked sits inside
    // another literal.
    if (masked[i] !== char) {
      continue
    }
    const close = masked.indexOf(char, i + 1)
    if (close === -1) {
      break
    }
    if (VERDICT_CALL_RE.test(masked.slice(0, i))) {
      found.push({ index: i, text: source.slice(i + 1, close) })
    }
    i = close
  }
  return found
}

/**
 * Whether `entry` names `hookName` to an operator reading the shipped line.
 * Either the literal spells `<hook-name>:`, or it composes through
 * `verdictLine(kind, name, …)`, which prepends the name itself.
 */
export function namesHook(entry: string, hookName: string): boolean {
  if (entry.includes(`${hookName}:`) || NAME_HOLE_RE.test(entry)) {
    return true
  }
  const match = VERDICT_LINE_NAME_RE.exec(entry)
  if (!match) {
    return false
  }
  // A quoted name must match the hook; an identifier is the hook's own NAME
  // constant, which the guard-name check already keeps honest.
  return match[1] === undefined || match[1] === hookName
}

/**
 * Report every quiet-guards violation in a one-literal verdict message.
 *
 * The lines come from the literal's own `\n` escapes, so a message built as one
 * string is judged by what an operator reads rather than by how it was written.
 */
export function scanSingleStringMessage(
  text: string,
  hookName: string,
  line: number,
): GuardBlockFinding[] {
  const findings: GuardBlockFinding[] = []
  const lines = text
    .split('\\n')
    .map(one => one.trim())
    .filter(one => one.length > 0)
  const content = lines.filter(one => !BYPASS_RE.test(one))
  const first = content[0]
  if (first === undefined) {
    return findings
  }
  // A first line that is only an interpolation carries its text somewhere else,
  // so whether it names the hook is unknowable from here.
  if (
    !WHOLE_HOLE_RE.test(first) &&
    !LEGACY_PREFIX_RE.test(first) &&
    !namesHook(first, hookName)
  ) {
    findings.push({
      detail: `first line does not name \`${hookName}:\``,
      kind: 'unnamed-first-line',
      line,
    })
  }
  if (LEGACY_PREFIX_RE.test(first)) {
    findings.push({
      detail: 'retired `[hook-name] Blocked:` prefix',
      kind: 'legacy-prefix',
      line,
    })
  }
  if (text.includes(EM_DASH)) {
    findings.push({
      detail: 'em-dash in a block line',
      kind: 'em-dash',
      line,
    })
  }
  if (content.length > MAX_BLOCK_CONTENT_LINES) {
    findings.push({
      detail: `${content.length} content lines, cap is ${MAX_BLOCK_CONTENT_LINES}`,
      kind: 'too-many-lines',
      line,
    })
  }
  return findings
}

/**
 * The string literals inside one block element, bodies only.
 *
 * An element is not always a bare literal: a conditional element picks between
 * two lines, and each arm is a line the operator can see. Reading the literals
 * lets the rules judge the arms rather than the expression that chose them.
 */
export function entryLiterals(entry: string): string[] {
  const masked = maskStringContents(entry)
  const literals: string[] = []
  for (let i = 0, { length } = entry; i < length; i += 1) {
    const char = entry[i]
    if (char !== "'" && char !== '"' && char !== '`') {
      continue
    }
    // The mask blanked the body, so the matching close is the next occurrence of
    // the same delimiter that the mask left in place.
    const close = masked.indexOf(char, i + 1)
    if (close === -1) {
      break
    }
    literals.push(entry.slice(i + 1, close))
    i = close
  }
  return literals
}

/**
 * Whether an element renders a `Fix:` line, in any of its conditional arms.
 */
export function carriesFixLine(entry: string): boolean {
  if (FIX_RE.test(entry)) {
    return true
  }
  return entryLiterals(entry).some(text => text.startsWith('Fix:'))
}

/**
 * The longest rendered line an element can produce, measured on its literals so
 * a conditional element is judged by its arms rather than by their sum.
 */
export function longestLiteralLength(entry: string): number {
  const literals = entryLiterals(entry)
  if (literals.length === 0) {
    return entry.length
  }
  let longest = 0
  for (const text of literals) {
    if (text.length > longest) {
      longest = text.length
    }
  }
  return longest
}

/**
 * The 1-indexed line `index` falls on in `source`.
 */
export function lineOfIndex(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      line += 1
    }
  }
  return line
}

// `block(lines.join('\n'))`: a verdict joined from an array the code PUSHES
// into, rather than from an array literal. `findJoinedArrays` needs a literal
// `[ … ]` and `findSingleStringMessages` needs a quote directly after `block(`,
// so this third shape was invisible to both. That blind spot is how a message
// carrying two em-dashes per hit, and repeating its remedy once per hit, passed
// a clean gate run over every hook in the fleet.
const DYNAMIC_JOIN_RE = /\b(?:block|notify)\(\s*[A-Za-z_$][\w$]*\s*\.join\(/

// The same shape, capturing the array's name so the walk can find the calls
// that fill it. Global: a hook may join more than one array.
const DYNAMIC_JOIN_NAME_RE =
  /\b(?:block|notify)\(\s*([A-Za-z_$][\w$]*)\s*\.join\(/g

// The verdict-line builders. Whatever reaches one of these renders as a line an
// operator reads, so it is a block line no matter how it was assembled.
const VERDICT_LINE_CALLS: readonly string[] = [
  'verdictContinuation(',
  'verdictLine(',
]

// An identifier token, used to find the bindings a verdict-line argument reads.
const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g

// How far to follow `const` bindings out from a verdict-line argument. Two
// covers argument -> branch constant -> shared remedy constant, the shape the
// fleet's hooks actually use; deeper is guesswork about scope rather than
// evidence, since this walk matches by name across the whole file.
const MAX_BINDING_DEPTH = 2

/**
 * True when `source` emits a verdict by joining an array it built at runtime.
 */
export function hasDynamicJoinedMessage(source: string): boolean {
  return DYNAMIC_JOIN_RE.test(maskStringContents(source))
}

/**
 * Index of the `)` closing the call whose `(` sits at `open`. Walks the MASKED
 * source so a paren inside a literal or a comment never closes the call.
 */
function findCallEnd(masked: string, open: number): number {
  let depth = 0
  for (let i = open, { length } = masked; i < length; i += 1) {
    const char = masked[i]
    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

/**
 * Start index of the LAST argument between `open` and `close`. The message is
 * the final parameter of both verdict builders, so the last argument is the
 * line to judge.
 */
function lastArgumentStart(
  masked: string,
  open: number,
  close: number,
): number {
  let depth = 0
  let start = open + 1
  for (let i = open + 1; i < close; i += 1) {
    const char = masked[i]
    if (char === '(' || char === '[' || char === '{') {
      depth += 1
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1
    } else if (char === ',' && depth === 0) {
      start = i + 1
    }
  }
  return start
}

/**
 * Every string/template literal between `from` and `to`.
 */
function literalsBetween(
  masked: string,
  source: string,
  from: number,
  to: number,
): SingleStringMessage[] {
  const found: SingleStringMessage[] = []
  for (let i = from; i < to; i += 1) {
    const char = source[i]
    if (char !== "'" && char !== '"' && char !== '`') {
      continue
    }
    // A quote the mask KEPT is a real delimiter; one it blanked sits inside
    // another literal or a comment.
    if (masked[i] !== char) {
      continue
    }
    const close = masked.indexOf(char, i + 1)
    if (close === -1 || close > to) {
      break
    }
    found.push({ index: i, text: source.slice(i + 1, close) })
    i = close
  }
  return found
}

/**
 * The span of `const <name> = …`, or undefined when there is no such binding.
 *
 * The initializer ends at the next non-blank line indented at or ABOVE the
 * declaration, which is where the next statement begins in a formatted tree.
 * Leaning on the formatter keeps this a few lines instead of an expression
 * parser, and the fleet's sources are all oxfmt output.
 */
function bindingSpan(
  masked: string,
  name: string,
): { from: number; to: number } | undefined {
  const needle = `const ${name}`
  let at = masked.indexOf(needle)
  while (at !== -1) {
    const after = masked[at + needle.length]
    // Whole-identifier match only, so `FIX_LINE` never resolves `FIX_LINES`.
    if (after === ' ' || after === ':' || after === '=') {
      const eq = masked.indexOf('=', at + needle.length)
      if (eq !== -1) {
        // A block LINE is a string. A binding initialized to an object or an
        // array is a data table, and following one pulls in prose that never
        // reaches a verdict: `const NAMED_TASK_REFS = { closingHint: '…' }`
        // was reported as an over-long em-dashed block line on that basis.
        // WHITESPACE_CHARS covers `\r`, so a CRLF checkout does not stop the
        // skip on the carriage return and read it as the initializer's first
        // character, which would follow every object binding again.
        let peek = eq + 1
        while (WHITESPACE_CHARS.has(masked[peek] ?? '')) {
          peek += 1
        }
        if (masked[peek] === '[' || masked[peek] === '{') {
          at = masked.indexOf(needle, at + 1)
          continue
        }
        const lineStart = masked.lastIndexOf('\n', at) + 1
        let indent = 0
        while (masked[lineStart + indent] === ' ') {
          indent += 1
        }
        let cursor = eq + 1
        while (cursor < masked.length) {
          const newline = masked.indexOf('\n', cursor)
          if (newline === -1) {
            return { from: eq + 1, to: masked.length }
          }
          let scan = newline + 1
          let width = 0
          while (masked[scan] === '\t' || masked[scan] === ' ') {
            width += 1
            scan += 1
          }
          // `\r` ends the line too: on a CRLF checkout a blank line reads as
          // `\r\n`, so testing only for `\n` would take the carriage return for
          // the start of the next statement and cut the initializer short.
          const blank = masked[scan] === '\n' || masked[scan] === '\r'
          if (!blank && scan < masked.length && width <= indent) {
            return { from: eq + 1, to: newline }
          }
          cursor = newline + 1
        }
        return { from: eq + 1, to: masked.length }
      }
    }
    at = masked.indexOf(needle, at + 1)
  }
  return undefined
}

/**
 * Every literal that becomes a line of a runtime-assembled verdict.
 *
 * Anchored on the ARRAY the message is joined from: the walk reads the name out
 * of `block(<name>.join(…))` and then judges every `<name>.push(…)` argument.
 * That is the shape the fleet actually uses, and anchoring on the verdict
 * builders alone missed it, because most hooks push their lines as bare
 * template literals without calling one. The builders are anchors too, for the
 * hooks that do.
 *
 * An inline literal is read where it sits. An argument passed as an identifier
 * is resolved through its `const` binding, and a binding that reads further
 * identifiers is followed too, up to {@link MAX_BINDING_DEPTH}. Two levels is
 * what the real shape needs: a hook picks the line in a `const body = …`
 * branch, and that branch interpolates a shared remedy constant, so a message
 * whose only em-dash lives in the constant would escape a one-level walk.
 */
export function findVerdictLineLiterals(source: string): SingleStringMessage[] {
  const masked = maskStringContents(source)
  // `<joined array>.push(` for every array a verdict is joined from, plus the
  // verdict builders themselves.
  const anchors: string[] = [...VERDICT_LINE_CALLS]
  for (const match of masked.matchAll(DYNAMIC_JOIN_NAME_RE)) {
    const anchor = `${match[1]!}.push(`
    if (!anchors.includes(anchor)) {
      anchors.push(anchor)
    }
  }
  const found: SingleStringMessage[] = []
  const seen = new Set<number>()
  const visited = new Set<string>()
  const push = (literal: SingleStringMessage): void => {
    if (!seen.has(literal.index)) {
      seen.add(literal.index)
      found.push(literal)
    }
  }
  // Collect the literals in [from, to), then follow the identifiers it reads.
  // `visited` is keyed by binding name so a constant referenced from two
  // branches is walked once and a self-referential one cannot loop.
  const collect = (from: number, to: number, depth: number): void => {
    for (const literal of literalsBetween(masked, source, from, to)) {
      push(literal)
    }
    if (depth >= MAX_BINDING_DEPTH) {
      return
    }
    for (const match of masked.slice(from, to).matchAll(IDENTIFIER_RE)) {
      const name = match[0]
      if (visited.has(name)) {
        continue
      }
      visited.add(name)
      const span = bindingSpan(masked, name)
      if (span) {
        collect(span.from, span.to, depth + 1)
      }
    }
  }
  for (let c = 0, { length: anchorCount } = anchors; c < anchorCount; c += 1) {
    const call = anchors[c]!
    // A verdict builder takes the message as its LAST parameter, so only that
    // argument is a line. `push` takes nothing but lines, so all of them are.
    const lastArgOnly = VERDICT_LINE_CALLS.includes(call)
    let at = masked.indexOf(call)
    while (at !== -1) {
      const open = at + call.length - 1
      const close = findCallEnd(masked, open)
      if (close !== -1) {
        visited.clear()
        const from = lastArgOnly
          ? lastArgumentStart(masked, open, close)
          : open + 1
        collect(from, close, 0)
      }
      at = masked.indexOf(call, at + 1)
    }
  }
  return found
}

/**
 * Report every quiet-guards violation in `source`, a hook's `index.mts`.
 *
 * `hookName` is the hook's directory name. The first content line has to open
 * with it, so a block that names a different hook or names none is a finding:
 * an operator reading a block needs to know which guard produced it.
 */
export function scanGuardBlocks(
  source: string,
  hookName: string,
): GuardBlockFinding[] {
  const findings: GuardBlockFinding[] = []
  for (const found of findJoinedArrays(source)) {
    if (!BLOCK_MARKER_RE.test(found.body)) {
      continue
    }
    findings.push(
      ...scanOneBlock(found.body, hookName, lineOfIndex(source, found.index)),
    )
  }
  for (const found of findSingleStringMessages(source)) {
    findings.push(
      ...scanSingleStringMessage(
        found.text,
        hookName,
        lineOfIndex(source, found.index),
      ),
    )
  }
  // The runtime-assembled shape. Gated on the dynamic join so a hook already
  // covered by the two literal walks above is not reported twice, and limited
  // to the PER-LINE rules: how many lines such a message renders depends on the
  // hit count, which is the operator's own reply, not a property of the source.
  if (hasDynamicJoinedMessage(source)) {
    for (const found of findVerdictLineLiterals(source)) {
      findings.push(
        ...scanDynamicVerdictLine(found.text, lineOfIndex(source, found.index)),
      )
    }
  }
  return findings
}

/**
 * The per-line rules for one runtime-assembled verdict line.
 *
 * Only the rules that hold for a single line in isolation: an em-dash never
 * belongs in operator output, and a line has a width budget. The structural
 * rules (first line names the hook, one `Fix:` line, no interior padding)
 * describe a whole message, and a message assembled per hit does not have its
 * final shape until it runs.
 */
export function scanDynamicVerdictLine(
  text: string,
  line: number,
): GuardBlockFinding[] {
  const findings: GuardBlockFinding[] = []
  if (text.includes(EM_DASH)) {
    findings.push({
      detail: 'em-dash in a runtime-assembled block line',
      kind: 'em-dash',
      line,
    })
  }
  if (text.length > MAX_BLOCK_LINE_LENGTH) {
    findings.push({
      detail: `${text.length} chars in a runtime-assembled block line, cap is ${MAX_BLOCK_LINE_LENGTH}`,
      kind: 'line-too-long',
      line,
    })
  }
  return findings
}

/**
 * The per-block half of `scanGuardBlocks`, split out so each rule reads as one
 * condition rather than a branch inside the walk.
 */
export function scanOneBlock(
  body: string,
  hookName: string,
  line: number,
): GuardBlockFinding[] {
  const findings: GuardBlockFinding[] = []
  const entries = splitBlockEntries(body)
  // A spread element renders one line per offending path, so counting it as
  // prose would report a finding whose size is the operator's own tree.
  const content = entries.filter(
    entry =>
      !isBlankPadding(entry) && !isBypassLine(entry) && !SPREAD_RE.test(entry),
  )
  // Only a spacer BETWEEN content lines is padding. A trailing one sits before
  // the bypass line the framework already spaces off, so it changes nothing an
  // operator reads.
  const lastContent = entries.findLastIndex(
    entry => !isBlankPadding(entry) && !isBypassLine(entry),
  )
  const interior = entries.filter(
    (entry, index) => isBlankPadding(entry) && index < lastContent,
  )
  if (interior.length) {
    findings.push({
      detail: `${interior.length} empty string element(s) between content lines`,
      kind: 'interior-padding',
      line,
    })
  }
  if (content.length > MAX_BLOCK_CONTENT_LINES) {
    findings.push({
      detail: `${content.length} content lines, cap is ${MAX_BLOCK_CONTENT_LINES}`,
      kind: 'too-many-lines',
      line,
    })
  }
  const first = content[0]
  if (first !== undefined && LEGACY_PREFIX_RE.test(first)) {
    findings.push({
      detail: 'retired `[hook-name] Blocked:` prefix',
      kind: 'legacy-prefix',
      line,
    })
  } else if (first !== undefined && !namesHook(first, hookName)) {
    findings.push({
      detail: `first line does not name \`${hookName}:\``,
      kind: 'unnamed-first-line',
      line,
    })
  }
  // An element built elsewhere and passed in by name carries no text here, so
  // whether it is the Fix line is unknowable from this file. Reporting one
  // would be a guess, so the rule stands down.
  const opaque = content.some(entry => entryLiterals(entry).length === 0)
  if (
    content.length > 1 &&
    !opaque &&
    !content.some(entry => carriesFixLine(entry))
  ) {
    findings.push({
      detail: 'no `Fix:` line',
      kind: 'missing-fix',
      line,
    })
  }
  if (entries.some(entry => entry.includes(EM_DASH))) {
    findings.push({
      detail: 'em-dash in a block line',
      kind: 'em-dash',
      line,
    })
  }
  const longest = content.reduce(
    (worst, entry) => Math.max(worst, longestLiteralLength(entry)),
    0,
  )
  if (longest > MAX_BLOCK_LINE_LENGTH) {
    findings.push({
      detail: `${longest} characters on one line, cap is ${MAX_BLOCK_LINE_LENGTH}`,
      kind: 'line-too-long',
      line,
    })
  }
  return findings
}

/**
 * One report line per finding, in the What / Where / Fix order the fleet error
 * shape uses.
 */
export function renderGuardBlockFinding(
  file: string,
  finding: GuardBlockFinding,
): string {
  return `${file}:${finding.line}: ${finding.kind} - ${finding.detail}`
}
