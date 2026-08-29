/**
 * @file Flags an identifier named `primeX` or `seedX` and autofixes it to
 *   `setupX`.
 *   "Prime the roster" reads as a verb for filling something in, but it says
 *   nothing about WHAT it fills or that the thing is durable state. The fleet
 *   spells that work `setup`: eleven `scripts/fleet/setup/<thing>.mts` steps
 *   with matching `setup:<thing>` package scripts. A `prime*` function beside
 *   them is the same operation under a name a reader has to learn separately,
 *   and it hides from anyone grepping `setup` for "what initialises state".
 *   The rename that motivated this: `primeFleetRoster` populates the
 *   `private_repo_roster` table in the Socket state DB, and lived next to a
 *   script called `prime-repo-roster.mts`. Neither name said "DB", and neither
 *   sorted with the setup steps doing the same kind of work.
 *   SCOPE IS DELIBERATELY THE LEADING WORD ONLY. `primeX` is reported;
 *   `doPrimeX` is not. A mid-name `Prime` is far more likely to be the
 *   mathematical sense or a compound noun, and a rule that nagged about those
 *   would be disabled rather than obeyed. The math sense is also allowlisted
 *   outright, because `primeFactors` matches the leading-word shape while
 *   having nothing to do with setup.
 *   Autofix swaps the leading `prime` for `setup` and leaves the rest of the
 *   name alone, so `primeFleetRoster` becomes `setupFleetRoster`. The fix
 *   applies to every occurrence, declaration and call site alike, because a
 *   partial rename does not compile.
 */

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// `prime` or `seed` as the leading word: `primeRoster`, `seedRepo`,
// `seed_path`, `SEED_TARGET`. Anchored so `doPrimeX`, `reprime` and
// `reseed` are untouched.
// require-regex-comment: leading `prime`/`seed` word in an identifier.
const LEADING_WORD_RE = /^(PRIME|Prime|SEED|Seed|prime|seed)(?=$|[A-Z_])/

// Senses that match the shape above and mean nothing like setup. Extend this
// rather than weakening the anchor.
//
// `prime*`: the mathematical sense. `seed*`: the RNG/fuzz sense, where a seed
// is an input value rather than an act of preparing something — vitiate's fuzz
// runner reports "all seeds evaluated", and renaming that reads as nonsense.
const OTHER_SENSE: ReadonlySet<string> = new Set([
  'prime',
  'primeFactor',
  'primeFactorization',
  'primeFactors',
  'primeNumber',
  'primeNumbers',
  'primes',
  'primeSieve',
  'seed',
  'seedRandom',
  'seedRng',
  'seeds',
])

/**
 * The `setup`-prefixed form of an identifier, preserving the case shape of the
 * rest of the name. Returns undefined when the name is not the flagged shape.
 */
export function setupNameFor(name: string): string | undefined {
  if (OTHER_SENSE.has(name)) {
    return undefined
  }
  const match = LEADING_WORD_RE.exec(name)
  if (!match) {
    return undefined
  }
  const matched = match[1]!
  const rest = name.slice(matched.length)
  if (matched === matched.toUpperCase()) {
    return `SETUP${rest}`
  }
  if (matched[0] === matched[0]!.toUpperCase()) {
    return `Setup${rest}`
  }
  return `setup${rest}`
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Name state-initialising code `setup*` rather than `prime*` or `seed*`, matching the fleet’s setup steps.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferSetup:
        'Rename `{{from}}` to `{{to}}`. The fleet spells state initialisation `setup*` (see scripts/fleet/setup/), so a `prime*` or `seed*` name hides the same work from anyone grepping for it.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    function report(node: AstNode | undefined): void {
      if (!node || node.type !== 'Identifier') {
        return
      }
      const name = (node as { name?: string | undefined }).name
      if (typeof name !== 'string') {
        return
      }
      const renamed = setupNameFor(name)
      if (renamed === undefined) {
        return
      }
      context.report({
        node,
        messageId: 'preferSetup',
        data: { from: name, to: renamed },
        fix(fixer: RuleFixer) {
          return fixer.replaceText(node, renamed)
        },
      })
    }
    // FUNCTION POSITION ONLY, which is where the verb sense lives. `seed` is
    // heavily overloaded as a NOUN — `seedPath` is the first path in a list,
    // `seedGap` is a set of missing keys, `seedIfAbsent` is a manifest field —
    // and renaming a noun to `setup*` makes it wrong rather than clearer. A
    // function called `seedRepo` is doing the work this rule is about; a
    // variable called `seedPath` is not.
    return {
      FunctionDeclaration(node: AstNode) {
        report((node as { id?: AstNode | undefined }).id)
      },
      VariableDeclarator(node: AstNode) {
        const init = (node as { init?: AstNode | undefined }).init
        const isFn =
          init?.type === 'ArrowFunctionExpression' ||
          init?.type === 'FunctionExpression'
        if (isFn) {
          report((node as { id?: AstNode | undefined }).id)
        }
      },
      CallExpression(node: AstNode) {
        report((node as { callee?: AstNode | undefined }).callee)
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
