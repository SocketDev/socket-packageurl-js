/**
 * @file A test must not assert the PROSE of an error or guard message. Message
 *   wording is edited constantly: every sweep that tightens a block message,
 *   every rewording of a thrown `Error`, breaks an assertion that quoted a
 *   sentence, and the failure says nothing about behavior. The stable surface
 *   is the error CODE, the error TYPE, the verdict kind, and short labelled
 *   tokens the contract fixes in place, so those are what a test pins. Measured
 *   cost of not having this rule: one pithy-output sweep across the hook tree
 *   left 196 failing assertions in 68 test files, every one of them a quoted
 *   sentence from a message that had been reworded on purpose. What counts as a
 *   message: the assertion subject is named for one, so `err.message`,
 *   `result.message`, `r?.message`, `msg`, `block`, `stderr`, `stdout`, and
 *   their siblings. A subject with any other name is untouched, which keeps an
 *   assertion about a command string or a path out of scope. What counts as
 *   prose: a quoted literal or regex carrying at least `PROSE_WORD_MIN` words,
 *   or any equality against a literal holding a space. A short token stays
 *   legal by construction, so `assert.match(msg, /^Fix:/)`, `/no-tsx-guard:/`,
 *   and `assert.equal(err.code, 'ERR_INVALID_ARG')` all pass. Report-only. The
 *   right replacement is a judgment call: sometimes the error code, sometimes
 *   the verdict kind, sometimes a one-word token, and no fixer can pick among
 *   them.
 */

import { TEST_FILE_RE } from '../../lib/test-file.mts'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// Words in a literal past which it reads as a sentence rather than a token.
export const PROSE_WORD_MIN = 6

// Property and variable names that hold a human-facing message.
//
// `reason` is deliberately absent: across the fleet it usually holds a short
// structured verdict a report row carries, so gating it reported enum values
// like `'no boundary'` as prose.
const MESSAGE_NAMES: ReadonlySet<string> = new Set([
  'banner',
  'block',
  'blockMessage',
  'message',
  'msg',
  'nudge',
  'nudgeMessage',
  'output',
  'report',
  'stderr',
  'stdout',
])

// The subset of MESSAGE_NAMES that only reads as a message once the receiver
// says so. `data.message` is a JSON response payload and `result.stderr` is
// captured process output: in both the string IS the subject under test, so
// gating on the property name alone reported 20+ correct assertions fleet-wide.
// The guard-specific names (banner, block, nudge, report) stay unconditional.
const RECEIVER_DEPENDENT_NAMES: ReadonlySet<string> = new Set([
  'message',
  'output',
  'stderr',
  'stdout',
])

// Captured output is a message only off an error, never off a spawn result.
const CAPTURED_OUTPUT_NAMES: ReadonlySet<string> = new Set([
  'output',
  'stderr',
  'stdout',
])

// An identifier holding a thrown value: the conventional catch bindings, plus
// anything whose name ends in `error` (`spawnError`, `lastError`).
const ERROR_RECEIVER_RE = /^(?:caught|e|err|error|ex|thrown)$|error$/i

// A hook's verdict object, whose `.message` is the block prose this rule is
// about. The fleet spells it `r`, `res`, `result`, or `verdict`.
const VERDICT_RECEIVER_RE = /^(?:r|res|result|verdict)$/

/**
 * Whether `node` names a thrown value or a hook verdict, so its `.message` is
 * prose the fleet wrote rather than a field that happens to share the name.
 */
export function isErrorReceiver(
  node: AstNode | undefined,
  options?: { verdictCounts?: boolean | undefined } | undefined,
): boolean {
  const opts = { __proto__: null, ...options } as {
    verdictCounts?: boolean | undefined
  }
  if (!node) {
    return false
  }
  const matches = (name: string): boolean =>
    ERROR_RECEIVER_RE.test(name) ||
    (opts.verdictCounts === true && VERDICT_RECEIVER_RE.test(name))
  if (node.type === 'Identifier' && typeof node.name === 'string') {
    return matches(node.name)
  }
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property?.type === 'Identifier' &&
    typeof node.property.name === 'string'
  ) {
    return matches(node.property.name)
  }
  if (node.type === 'ChainExpression' || node.type === 'TSNonNullExpression') {
    return isErrorReceiver(node.expression, options)
  }
  return false
}

// node:assert members that compare a value against a pattern.
const ASSERT_PATTERN_METHODS: ReadonlySet<string> = new Set([
  'doesNotMatch',
  'match',
])

// node:assert members that compare a value against a literal.
const ASSERT_EQUALITY_METHODS: ReadonlySet<string> = new Set([
  'deepEqual',
  'deepStrictEqual',
  'equal',
  'notEqual',
  'strictEqual',
])

// vitest matchers that compare against a pattern.
const EXPECT_PATTERN_MATCHERS: ReadonlySet<string> = new Set([
  'toContain',
  'toMatch',
])

// vitest matchers that compare against a literal.
const EXPECT_EQUALITY_MATCHERS: ReadonlySet<string> = new Set([
  'toBe',
  'toEqual',
  'toStrictEqual',
])

// String methods a test calls on a message before asserting on the result.
const SUBSTRING_METHODS: ReadonlySet<string> = new Set([
  'endsWith',
  'includes',
  'startsWith',
])

/**
 * Whether an expression names a message: a bare `msg`, a `foo.message`, or the
 * same reached through an optional chain.
 */
export function isMessageSubject(node: AstNode | undefined): boolean {
  if (!node || typeof node !== 'object') {
    return false
  }
  if (node.type === 'Identifier') {
    // A BARE identifier has no receiver to qualify it, so the ambiguous names
    // are out: `expect(output).toBe('raw text')` asserts what a logger wrote
    // and `expect(stdout).toBe(...)` asserts git porcelain, the subject in both.
    return (
      MESSAGE_NAMES.has(node.name) && !RECEIVER_DEPENDENT_NAMES.has(node.name)
    )
  }
  if (node.type === 'ChainExpression' || node.type === 'TSNonNullExpression') {
    return isMessageSubject(node.expression)
  }
  if (node.type === 'LogicalExpression') {
    // `r?.message ?? ''`, the shape a nullable verdict is asserted through.
    return isMessageSubject(node.left)
  }
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property?.type === 'Identifier'
  ) {
    const property = node.property.name
    if (!MESSAGE_NAMES.has(property)) {
      return false
    }
    if (!RECEIVER_DEPENDENT_NAMES.has(property)) {
      return true
    }
    return isErrorReceiver(node.object, {
      verdictCounts: !CAPTURED_OUTPUT_NAMES.has(property),
    })
  }
  if (node.type === 'CallExpression') {
    // `nudgeMessage()` / `blockMessage(d)` read as the message they build.
    return isMessageSubject(node.callee)
  }
  return false
}

/**
 * The text a literal or regex node compares against, or undefined when the node
 * is not a literal the rule can read.
 */
export function comparedText(node: AstNode | undefined): string | undefined {
  if (!node || typeof node !== 'object') {
    return undefined
  }
  if (node.type === 'Literal') {
    if (node.regex) {
      return String(node.regex.pattern)
    }
    return typeof node.value === 'string' ? node.value : undefined
  }
  if (node.type === 'TemplateLiteral' && node.quasis?.length === 1) {
    return String(node.quasis[0]?.value?.cooked ?? '')
  }
  return undefined
}

// The regex spellings of a gap between words, normalized to a plain space so a
// pattern written `the\s+plugin\s+failed` counts its words like prose.
const PATTERN_GAP_RE = /\\s[*+?]?|\.[*+]\??/g

// A token counts as a word once it holds two adjacent letters.
const WORD_RE = /[A-Za-z]{2}/

/**
 * How many words a compared literal carries.
 *
 * Words are whitespace-separated and have to hold two adjacent letters, so
 * regex punctuation, a flag, and a version number do not inflate the total. A
 * snake or kebab token counts once: `ERR_SINGLE_LANDER` is one name an operator
 * reads, not three words.
 */
export function proseWordCount(text: string): number {
  const tokens = text.replace(PATTERN_GAP_RE, ' ').split(/\s+/)
  let count = 0
  for (let i = 0, { length } = tokens; i < length; i += 1) {
    if (WORD_RE.test(tokens[i]!)) {
      count += 1
    }
  }
  return count
}

/**
 * Whether a compared literal reads as prose rather than a stable token.
 *
 * `options.exact` marks an equality comparison, where any multi-word literal is
 * the whole message and so breaks on the next rewording.
 */
export function isProseComparison(
  text: string,
  options?: { exact?: boolean | undefined } | undefined,
): boolean {
  const opts = { __proto__: null, ...options } as {
    exact?: boolean | undefined
  }
  if (opts.exact === true) {
    return text.trim().includes(' ')
  }
  return proseWordCount(text) >= PROSE_WORD_MIN
}

/**
 * The `assert.<method>` name of a call, or undefined when the callee is not an
 * assert member.
 */
export function assertMethodName(node: AstNode): string | undefined {
  const { callee } = node
  if (
    callee?.type !== 'MemberExpression' ||
    callee.computed ||
    callee.property?.type !== 'Identifier' ||
    callee.object?.type !== 'Identifier'
  ) {
    return undefined
  }
  return callee.object.name === 'assert' ? callee.property.name : undefined
}

/**
 * The matcher name of an `expect(...).<matcher>(...)` call plus the value the
 * inner `expect(...)` received, or undefined when the call is not a matcher
 * invocation.
 */
export function expectMatcher(
  node: AstNode,
): { matcher: string; subject: AstNode } | undefined {
  const { callee } = node
  if (
    callee?.type !== 'MemberExpression' ||
    callee.computed ||
    callee.property?.type !== 'Identifier'
  ) {
    return undefined
  }
  let inner: AstNode | undefined = callee.object
  // `expect(x).not.toBe(...)` puts a `.not` between the call and the matcher.
  while (
    inner?.type === 'MemberExpression' &&
    !inner.computed &&
    inner.property?.type === 'Identifier'
  ) {
    inner = inner.object
  }
  if (
    inner?.type !== 'CallExpression' ||
    inner.callee?.type !== 'Identifier' ||
    inner.callee.name !== 'expect' ||
    !Array.isArray(inner.arguments)
  ) {
    return undefined
  }
  return { matcher: callee.property.name, subject: inner.arguments[0] }
}

/**
 * For `assert.ok(msg.includes('…'))`, the message subject and the compared
 * literal, or undefined when the argument is not that shape.
 */
export function substringCall(
  node: AstNode | undefined,
): { subject: AstNode; text: string } | undefined {
  if (
    !node ||
    node.type !== 'CallExpression' ||
    node.callee?.type !== 'MemberExpression' ||
    node.callee.computed ||
    node.callee.property?.type !== 'Identifier' ||
    !SUBSTRING_METHODS.has(node.callee.property.name) ||
    !Array.isArray(node.arguments)
  ) {
    return undefined
  }
  const text = comparedText(node.arguments[0])
  return text === undefined ? undefined : { subject: node.callee.object, text }
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A test asserts an error or guard message by its prose; assert the error code, the error type, or a short stable token instead.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      messageProse:
        'Message prose is asserted here; pin the error code/type or a short token instead.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!TEST_FILE_RE.test(filename)) {
      return {}
    }
    const report = (node: AstNode): void => {
      context.report({ node, messageId: 'messageProse' })
    }
    return {
      CallExpression(node: AstNode) {
        const args: AstNode[] = Array.isArray(node.arguments)
          ? node.arguments
          : []
        const assertName = assertMethodName(node)
        if (assertName === 'match' || assertName === 'ok') {
          const inner = substringCall(args[0])
          if (
            inner &&
            isMessageSubject(inner.subject) &&
            isProseComparison(inner.text)
          ) {
            report(node)
            return
          }
        }
        if (assertName !== undefined) {
          const exact = ASSERT_EQUALITY_METHODS.has(assertName)
          if (exact || ASSERT_PATTERN_METHODS.has(assertName)) {
            const [first, second] = args
            const pairs: Array<[AstNode, AstNode]> = [
              [first, second],
              [second, first],
            ]
            for (const [subject, expected] of pairs) {
              const text = comparedText(expected)
              if (
                text !== undefined &&
                isMessageSubject(subject) &&
                isProseComparison(text, { exact })
              ) {
                report(node)
                return
              }
            }
          }
          return
        }
        const matched = expectMatcher(node)
        if (!matched) {
          return
        }
        const exact = EXPECT_EQUALITY_MATCHERS.has(matched.matcher)
        if (!exact && !EXPECT_PATTERN_MATCHERS.has(matched.matcher)) {
          return
        }
        const text = comparedText(args[0])
        if (
          text !== undefined &&
          isMessageSubject(matched.subject) &&
          isProseComparison(text, { exact })
        ) {
          report(node)
        }
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
