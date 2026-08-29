/**
 * @file A test must import a vendored package through its `src/external/`
 *   wrapper, by path, rather than through the package alias. A member vendors a
 *   package by writing `src/external/<name>.js` plus a hand-written
 *   `<name>.d.ts`, then aliasing the bare name to it in
 *   `.config/repo/tsconfig.check.json`. The alias exists for `src/` code, where
 *   the bundler applies the same mapping, so a library module reads `import
 *   'tar-fs'` and gets the wrapper. A test is not bundled, so the alias buys it
 *   nothing and costs it clarity: the import no longer says which of the two
 *   modules is under test, and it resolves only while the tsconfig mapping
 *   holds. Naming the wrapper is the point of vendoring - a `.d.ts` per package
 *   is what a member pays for the ability to choose exactly what it imports and
 *   how that is typed, and a test that goes through the alias spends the cost
 *   without taking the benefit. The alias set is read from the member's own
 *   tsconfig paths, so this rule cannot disagree with what the type gate
 *   resolves.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { TEST_FILE_RE } from '../../lib/test-file.mts'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// Where a member declares the aliases the type gate resolves. Single source of
// truth for the alias set: reading it here means the rule and the type pass
// cannot drift.
export const MEMBER_TSCONFIG = '.config/repo/tsconfig.check.json'

// Where a vendored wrapper lives, and the extension a test imports it by. The
// sibling `<name>.d.ts` is what types it.
export const VENDOR_DIR = 'src/external'
export const VENDOR_EXT = '.js'

/**
 * The nearest ancestor of `startDir` holding MEMBER_TSCONFIG, or undefined when
 * none does.
 *
 * Walked from the LINTED FILE rather than read from `process.cwd()`: oxlint's
 * cwd is not guaranteed to be the member root (an editor integration, a
 * monorepo invocation, or a harness all move it), and a wrong root silently
 * yields an empty alias set, which turns this rule off instead of failing. Same
 * walk-up prefer-stable-self-import uses to find its owning package.
 */
export function findRepoRoot(startDir: string): string | undefined {
  let dir = startDir
  // Stop at filesystem root.
  while (dir && dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, MEMBER_TSCONFIG))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  return undefined
}

/**
 * The bare package names a member aliases. Reads the member tsconfig's
 * `compilerOptions.paths` keys, keeping only those pointing into the vendor
 * directory - a member may alias other things, and only vendored wrappers are
 * this rule's subject. Returns an empty set when the file is absent or
 * unreadable, so a member without aliases is simply not gated.
 */
export function readVendoredAliases(repoRoot: string): ReadonlySet<string> {
  const configPath = path.join(repoRoot, MEMBER_TSCONFIG)
  if (!existsSync(configPath)) {
    return new Set()
  }
  let parsed: {
    compilerOptions?:
      | { paths?: Record<string, unknown> | undefined }
      | undefined
  }
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8')) as typeof parsed
  } catch {
    return new Set()
  }
  const paths = parsed.compilerOptions?.paths
  if (!paths) {
    return new Set()
  }
  const aliases = new Set<string>()
  const names = Object.keys(paths)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    const targets = paths[name]
    if (!Array.isArray(targets)) {
      continue
    }
    // Match VENDOR_DIR as a path SEGMENT, at the start or mid-path.
    // `normalizePath` strips a leading `./`, so the natural way to write the
    // target — `./src/external/tar-fs.js` — normalizes to
    // `src/external/tar-fs.js` and never contained `/src/external/`. Testing
    // only the mid-path form meant the rule collected no aliases for a member
    // writing it that way, and a rule with an empty alias set silently does
    // nothing.
    const pointsAtVendor = targets.some(target => {
      if (typeof target !== 'string') {
        return false
      }
      const normalized = normalizePath(target)
      return (
        normalized.startsWith(`${VENDOR_DIR}/`) ||
        normalized.includes(`/${VENDOR_DIR}/`)
      )
    })
    if (pointsAtVendor) {
      aliases.add(name)
    }
  }
  return aliases
}

/**
 * The specifier a test should use: the wrapper, relative to the test's own
 * directory. Always `./`-prefixed or `../`-leading, so it reads as a path
 * rather than another bare name.
 */
export function wrapperSpecifier(
  repoRoot: string,
  testFile: string,
  packageName: string,
): string {
  const wrapper = path.join(repoRoot, VENDOR_DIR, `${packageName}${VENDOR_EXT}`)
  const relative = normalizePath(path.relative(path.dirname(testFile), wrapper))
  return relative.startsWith('.') ? relative : `./${relative}`
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A test imports a vendored package by its alias; import the src/external wrapper by path instead.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      vendoredAlias:
        "Test imports '{{name}}' by alias; import the src/external wrapper by path ('{{specifier}}') so the test names the module it types against.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!TEST_FILE_RE.test(filename)) {
      return {}
    }
    const repoRoot = findRepoRoot(path.dirname(filename))
    if (!repoRoot) {
      return {}
    }
    const aliases = readVendoredAliases(repoRoot)
    if (aliases.size === 0) {
      return {}
    }
    return {
      ImportDeclaration(node: AstNode) {
        const source = node.source
        const name = source?.value
        if (typeof name !== 'string' || !aliases.has(name)) {
          return
        }
        const specifier = wrapperSpecifier(repoRoot, filename, name)
        context.report({
          node: source,
          messageId: 'vendoredAlias',
          data: { name, specifier },
          fix(fixer: RuleFixer) {
            // Replace the specifier literal only, so the import clause, any
            // `type` modifier, and the trailing semicolon style survive.
            return fixer.replaceText(source, `'${specifier}'`)
          },
        })
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
