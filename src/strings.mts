// Helpers grouped by domain (predicates, mutators, transforms,
// injection-detection); alphabetical order would scatter related functions.
/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- domain-grouped layout (pipeline flow / dispatch table); per-call would scatter the grouping with many redundant disables. */
/* oxlint-disable socket/sort-source-methods -- domain-grouped helpers */
/**
 * @file String utility functions for PURL processing. Includes whitespace
 *   detection, semver validation, locale comparison, and character
 *   replacement.
 */
import { NumberPrototypeToString } from '@socketsecurity/lib/primordials/number'
import { RegExpPrototypeTest } from '@socketsecurity/lib/primordials/regexp'
import {
  StringFromCharCode,
  StringPrototypeCharCodeAt,
  StringPrototypeIndexOf,
  StringPrototypePadStart,
  StringPrototypeSlice,
  StringPrototypeToLowerCase,
} from '@socketsecurity/lib/primordials/string'

/**
 * Check if string contains only whitespace characters.
 */
export function isBlank(str: string): boolean {
  return RegExpPrototypeTest(/^\s*$/, str)
}

/**
 * Check if value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// This regexp is valid as of 2024-08-01
// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const regexSemverNumberedGroups =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?:[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/**
 * Check if value is a valid semantic version string.
 */
export function isSemverString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    RegExpPrototypeTest(regexSemverNumberedGroups, value)
  )
}

// `Intl.Collator` is faster than `String#localeCompare`
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare:
// > When comparing large numbers of strings, such as in sorting large arrays,
// > it is better to create an `Intl.Collator` object and use the function provided
// > by its `comparePurls()` method
let cachedLocaleCompare: Intl.Collator['compare'] | undefined

/**
 * Perform locale-aware string comparison.
 */
export function localeCompare(x: string, y: string): number {
  if (cachedLocaleCompare === undefined) {
    // Lazily create the collator (10-14ms in Node). Per spec the `compare`
    // getter returns a function bound to its collator, so detaching is safe.
    // oxlint-disable-next-line typescript/unbound-method -- bound per spec
    cachedLocaleCompare = new Intl.Collator().compare
  }
  return cachedLocaleCompare(x, y)
}

/**
 * Convert package name to lowercase.
 */
export function lowerName(purl: { name: string }): void {
  purl.name = StringPrototypeToLowerCase(purl.name)
}

/**
 * Convert package namespace to lowercase.
 */
export function lowerNamespace(purl: { namespace?: string | undefined }): void {
  const { namespace } = purl
  if (typeof namespace === 'string') {
    purl.namespace = StringPrototypeToLowerCase(namespace)
  }
}

/**
 * Convert package version to lowercase.
 */
export function lowerVersion(purl: { version?: string | undefined }): void {
  const { version } = purl
  if (typeof version === 'string') {
    purl.version = StringPrototypeToLowerCase(version)
  }
}

/**
 * Replace all dashes with underscores in string.
 */
export function replaceDashesWithUnderscores(str: string): string {
  // Replace all `"-"` with `"_"`
  let result = ''
  let fromIndex = 0
  let index = 0
  while ((index = StringPrototypeIndexOf(str, '-', fromIndex)) !== -1) {
    result = `${result + StringPrototypeSlice(str, fromIndex, index)}_`
    fromIndex = index + 1
  }
  return fromIndex ? result + StringPrototypeSlice(str, fromIndex) : str
}

/**
 * Replace all underscores with dashes in string.
 */
export function replaceUnderscoresWithDashes(str: string): string {
  // Replace all `"_"` with `"-"`
  let result = ''
  let fromIndex = 0
  let index = 0
  while ((index = StringPrototypeIndexOf(str, '_', fromIndex)) !== -1) {
    result = `${result + StringPrototypeSlice(str, fromIndex, index)}-`
    fromIndex = index + 1
  }
  return fromIndex ? result + StringPrototypeSlice(str, fromIndex) : str
}

export function isUnicodeInjectionCharCode(code: number): boolean {
  return (
    code === 0x20_0b ||
    code === 0x20_0c ||
    code === 0x20_0d ||
    code === 0x20_0e ||
    code === 0x20_0f ||
    code === 0x20_2a ||
    code === 0x20_2b ||
    code === 0x20_2c ||
    code === 0x20_2d ||
    code === 0x20_2e ||
    code === 0x20_60 ||
    code === 0xfe_ff ||
    code === 0xff_fc ||
    code === 0xff_fd
  )
}

export function isAsciiInjectionPrefix(code: number): boolean {
  if (
    // space
    code === 0x20 ||
    // !
    code === 0x21 ||
    // "
    code === 0x22 ||
    // #
    code === 0x23 ||
    // $
    code === 0x24 ||
    // %
    code === 0x25 ||
    // &
    code === 0x26 ||
    // '
    code === 0x27 ||
    // (
    code === 0x28 ||
    // )
    code === 0x29 ||
    // *
    code === 0x2a ||
    // ;
    code === 0x3b
  ) {
    return true
  }
  return false
}

export function isAsciiInjectionSuffix(code: number): boolean {
  return (
    // <
    code === 0x3c ||
    // =
    code === 0x3d ||
    // >
    code === 0x3e ||
    // ?
    code === 0x3f ||
    // [
    code === 0x5b ||
    // \
    code === 0x5c ||
    // ]
    code === 0x5d ||
    // `
    code === 0x60 ||
    // {
    code === 0x7b ||
    // |
    code === 0x7c ||
    // }
    code === 0x7d ||
    // ~
    code === 0x7e ||
    // DEL
    code === 0x7f
  )
}

/**
 * Test whether a character code is an injection-dangerous character.
 *
 * Detects four classes of dangerous characters:
 *
 * 1. **Shell metacharacters** — command execution, piping, redirection, expansion:
 *    `|`, `&`, `;`, `` ` ``, `$`, `<`, `>`, `(`, `)`, `{`, `}`, `\`
 * 2. **Quote characters** — break out of quoted contexts in shell, SQL, URLs: `'`,
 *    `"`
 * 3. **URL/path delimiters** — fragment injection, comment injection: `#`
 * 4. **Whitespace & control characters** — argument splitting, log injection,
 *    terminal escape sequences, null-byte truncation: `0x00`-`0x1f` (all C0
 *    controls including NUL, tab, newline, CR, ESC, etc.) space (`0x20`), DEL
 *    (`0x7f`)
 */
export function isInjectionCharCode(code: number): boolean {
  return (
    code <= 0x1f ||
    isAsciiInjectionPrefix(code) ||
    isAsciiInjectionSuffix(code) ||
    (code >= 0x80 && code <= 0x9f) ||
    isUnicodeInjectionCharCode(code)
  )
}

/**
 * Test whether a character code enables command execution.
 *
 * A narrower scanner than `isInjectionCharCode`, targeting characters that
 * enable shell command execution and code injection. Allows characters that are
 * legitimate in version strings and URL-based qualifier values (like `!`, `+`,
 * `?`, `&`, `=`, `%`, `:`, `/`, `#`, space) while still blocking the most
 * dangerous execution vectors.
 *
 * Used for `version`, `subpath`, and qualifier value validation where the full
 * injection scanner would cause false positives.
 */
export function isCommandInjectionCharCode(code: number): boolean {
  // C0 control characters except tab (`0x09`) — tab is used in some
  // version metadata but other controls are never legitimate
  if (code <= 0x1f && code !== 0x09) {
    return true
  }
  // biome-ignore format: newlines
  if (
    // `$` — command substitution `$()`
    code === 0x24 ||
    // `;` — command separator
    code === 0x3b ||
    // `<` — input redirection
    code === 0x3c ||
    // `>` — output redirection
    code === 0x3e ||
    // `\` — escape character
    code === 0x5c ||
    // `` ` `` — command substitution (backtick form)
    code === 0x60 ||
    // `|` — pipe
    code === 0x7c ||
    // DEL
    code === 0x7f
  ) {
    return true
  }
  // C1 control characters
  if (code >= 0x80 && code <= 0x9f) {
    return true
  }
  return isUnicodeInjectionCharCode(code)
}

/**
 * Find the first command injection character in a string. Like
 * `findInjectionCharCode` but uses the narrower command injection set. Returns
 * the character code found, or `-1`.
 */
export function findCommandInjectionCharCode(str: string): number {
  for (let i = 0, { length } = str; i < length; i += 1) {
    const code = StringPrototypeCharCodeAt(str, i)
    if (isCommandInjectionCharCode(code)) {
      return code
    }
  }
  return -1
}

/**
 * Find the first injection character in a string. Returns the character code of
 * the first dangerous character found, or `-1`.
 *
 * Uses `charCode` scanning for performance in hot paths. The check is a single
 * pass with no allocation, no regex, and no prototype method calls beyond the
 * captured `StringPrototypeCharCodeAt` primordial.
 *
 * Null bytes (`0x00`) are also caught by `validateStrings()` in `validate.ts`,
 * but we include them here for defense-in-depth so callers who skip the base
 * validators still get protection.
 */
export function findInjectionCharCode(str: string): number {
  for (let i = 0, { length } = str; i < length; i += 1) {
    const code = StringPrototypeCharCodeAt(str, i)
    if (isInjectionCharCode(code)) {
      return code
    }
  }
  return -1
}

/**
 * Narrow injection check: only the characters that enable command/shell
 * injection when a component is interpolated into a shell, plus control
 * characters. Unlike {@link isInjectionCharCode}, this deliberately does NOT
 * flag PURL-spec-legal punctuation (`?`, `#`, `@`, `%`, `!`, `*`, `=`, `[`,
 * `]`, `{`, `}`, `~`, `"`, `'`) so that unregistered PURL types stay
 * spec-compliant while still rejecting genuine RCE payloads like `$(cmd)`,
 * backticks, and pipes. Registered types keep the stricter
 * {@link isInjectionCharCode} denylist via their own validators.
 */
export function isShellInjectionCharCode(code: number): boolean {
  // C0 control characters (0x00-0x1f), including null byte, newline, tab.
  if (code <= 0x1f) {
    return true
  }
  // biome-ignore format: newlines
  return (
    // $
    code === 0x24 ||
    // &
    code === 0x26 ||
    // (
    code === 0x28 ||
    // )
    code === 0x29 ||
    // ;
    code === 0x3b ||
    // <
    code === 0x3c ||
    // >
    code === 0x3e ||
    // backslash
    code === 0x5c ||
    // backtick
    code === 0x60 ||
    // |
    code === 0x7c ||
    // DEL
    code === 0x7f
  )
}

/**
 * Scan `str` for the first shell-injection character (see
 * {@link isShellInjectionCharCode}). Returns its char code, or `-1`.
 */
export function findShellInjectionCharCode(str: string): number {
  for (let i = 0, { length } = str; i < length; i += 1) {
    const code = StringPrototypeCharCodeAt(str, i)
    if (isShellInjectionCharCode(code)) {
      return code
    }
  }
  return -1
}

/**
 * Check if string contains characters commonly used in injection attacks.
 * Returns `true` if any dangerous character is found.
 *
 * For detailed information about which character was found, use
 * {@link findInjectionCharCode} instead.
 */
export function containsInjectionCharacters(str: string): boolean {
  return findInjectionCharCode(str) !== -1
}

/**
 * Format an injection character code as a human-readable label for error
 * messages. Returns a string like `"|" (0x7c)` for printable chars or `0x1b`
 * for control chars.
 */
export function formatInjectionChar(code: number): string {
  const hex = NumberPrototypeToString(code, 16)
  if (code >= 0x20 && code <= 0x7e) {
    return `"${StringFromCharCode(code)}" (0x${hex})`
  }
  return `0x${StringPrototypePadStart(hex, 2, '0')}`
}

/**
 * Remove leading slashes from string.
 */
export function trimLeadingSlashes(str: string): string {
  let start = 0
  while (StringPrototypeCharCodeAt(str, start) === 47 /*'/'*/) {
    start += 1
  }
  return start === 0 ? str : StringPrototypeSlice(str, start)
}
