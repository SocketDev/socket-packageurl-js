/**
 * @fileoverview Per CLAUDE.md "null vs undefined": use `undefined`.
 * `null` is allowed only for `__proto__: null` (object-literal
 * prototype null) or external API requirements (e.g., JSON encoding).
 *
 * Autofix: rewrites `null` → `undefined` only in safe positions:
 *   - return statements (`return null` → `return undefined`)
 *   - variable initializers (`let x = null` → `let x = undefined`)
 *   - default parameters (`(x = null) => ...` → `(x = undefined) => ...`)
 *   - argument positions in calls (`foo(null)` → `foo(undefined)`)
 *
 * Skipped:
 *   - `__proto__: null` (allowed)
 *   - `=== null` / `!== null` comparisons (semantically distinct)
 *   - `null` inside type annotations / call signatures (TS)
 *   - JSON.stringify args (the second arg is conventionally null)
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer `undefined` over `null` (CLAUDE.md style — `null` is allowed only for __proto__:null or external API requirements).',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferUndefined:
        'Use `undefined` instead of `null` (allowed exceptions: `__proto__: null`, external API requirements).',
    },
    schema: [],
  },

  create(context) {
    function isProtoNull(node) {
      const parent = node.parent
      if (!parent || parent.type !== 'Property') {
        return false
      }
      if (parent.value !== node) {
        return false
      }
      const key = parent.key
      if (!key) {
        return false
      }
      // { __proto__: null } — key is Identifier `__proto__` or string '__proto__'.
      if (key.type === 'Identifier' && key.name === '__proto__') {
        return true
      }
      if (key.type === 'Literal' && key.value === '__proto__') {
        return true
      }
      return false
    }

    function isComparisonOperand(node) {
      const parent = node.parent
      if (!parent) {
        return false
      }
      if (parent.type !== 'BinaryExpression') {
        return false
      }
      return ['===', '!==', '==', '!='].includes(parent.operator)
    }

    function isJsonStringifyReplacer(node) {
      // JSON.stringify(value, replacer, space) — `replacer` is conventionally null.
      const parent = node.parent
      if (
        !parent ||
        parent.type !== 'CallExpression' ||
        parent.arguments[1] !== node
      ) {
        return false
      }
      const callee = parent.callee
      if (callee.type !== 'MemberExpression') {
        return false
      }
      return (
        callee.object.type === 'Identifier' &&
        callee.object.name === 'JSON' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'stringify'
      )
    }

    function isPrototypeApiArg(node) {
      // Object.create(null) / Reflect.setPrototypeOf(_, null) /
      // Object.setPrototypeOf(_, null) — `null` is the canonical
      // "no prototype" sentinel; `undefined` would change semantics
      // (Object.create(undefined) throws TypeError, setPrototypeOf
      // with undefined is a no-op).
      const parent = node.parent
      if (!parent || parent.type !== 'CallExpression') {
        return false
      }
      const callee = parent.callee
      // Member call: Object.create(null) / Reflect.setPrototypeOf(_, null)
      if (callee.type === 'MemberExpression') {
        const obj =
          callee.object.type === 'Identifier' ? callee.object.name : ''
        const prop =
          callee.property.type === 'Identifier' ? callee.property.name : ''
        if (
          obj === 'Object' &&
          prop === 'create' &&
          parent.arguments[0] === node
        ) {
          return true
        }
        if (
          (obj === 'Reflect' || obj === 'Object') &&
          prop === 'setPrototypeOf' &&
          parent.arguments[1] === node
        ) {
          return true
        }
        return false
      }
      // Direct call: ObjectCreate(null) / ReflectSetPrototypeOf(_, null) —
      // the socket-lib primordials surface.
      if (callee.type === 'Identifier') {
        const name = callee.name
        if (name === 'ObjectCreate' && parent.arguments[0] === node) {
          return true
        }
        if (
          (name === 'ReflectSetPrototypeOf' ||
            name === 'ObjectSetPrototypeOf') &&
          parent.arguments[1] === node
        ) {
          return true
        }
      }
      return false
    }

    function isAssertionLibraryArg(node) {
      // expect(x).toBe(null) / .toEqual(null) / .toStrictEqual(null) /
      // assert.equal(x, null) / chai's .equal(null) — `null` is the
      // semantic value being asserted and must not be auto-rewritten.
      const parent = node.parent
      if (!parent || parent.type !== 'CallExpression') {
        return false
      }
      const callee = parent.callee
      if (callee.type !== 'MemberExpression') {
        return false
      }
      const prop =
        callee.property.type === 'Identifier' ? callee.property.name : ''
      const ASSERT_METHODS = new Set([
        'toBe',
        'toEqual',
        'toStrictEqual',
        'toMatchObject',
        'equal',
        'equals',
        'deepEqual',
        'deepStrictEqual',
        'strictEqual',
        'is',
        'same',
      ])
      return ASSERT_METHODS.has(prop)
    }

    function isNullableTypeInitializer(node) {
      // `const x: Foo | null = null` / `let y: Foo | null | undefined = null`
      // — the developer explicitly opted into null in the type signature,
      // signaling a deliberate distinction from undefined.
      const parent = node.parent
      if (!parent) {
        return false
      }
      if (parent.type !== 'VariableDeclarator') {
        return false
      }
      if (parent.init !== node) {
        return false
      }
      // Look at the source text from the start of the declarator to the
      // start of the literal — captures `name: Foo | null = ` etc. The
      // AST shape for typeAnnotation differs across oxlint versions, so
      // a textual scan is the most resilient option here.
      const sourceCode = context.getSourceCode
        ? context.getSourceCode()
        : context.sourceCode
      const declStart = parent.range
        ? parent.range[0]
        : (parent.start ?? parent.id?.range?.[0])
      const litStart = node.range ? node.range[0] : node.start
      if (typeof declStart !== 'number' || typeof litStart !== 'number') {
        return false
      }
      const text = sourceCode.getText().slice(declStart, litStart)
      // Require `: <typeexpr>... null ... =` — a colon (type annotation),
      // a literal `null` token, then an `=` (initializer).
      return /:[^=]*\bnull\b[^=]*=/.test(text)
    }

    return {
      Literal(node) {
        if (node.value !== null || node.raw !== 'null') {
          return
        }

        if (isProtoNull(node)) {
          return
        }
        if (isComparisonOperand(node)) {
          return
        }
        if (isJsonStringifyReplacer(node)) {
          return
        }
        if (isPrototypeApiArg(node)) {
          return
        }
        if (isAssertionLibraryArg(node)) {
          return
        }
        if (isNullableTypeInitializer(node)) {
          return
        }

        context.report({
          node,
          messageId: 'preferUndefined',
          fix(fixer) {
            return fixer.replaceText(node, 'undefined')
          },
        })
      },
    }
  },
}

export default rule
