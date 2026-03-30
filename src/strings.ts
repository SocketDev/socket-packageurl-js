/**
 * @fileoverview String utility functions for PURL processing.
 * Includes whitespace detection, semver validation, locale comparison, and character replacement.
 */
import {
  NumberPrototypeToString,
  ObjectFreeze,
  RegExpPrototypeTest,
  StringFromCharCode,
  StringPrototypeCharCodeAt,
  StringPrototypeIndexOf,
  StringPrototypePadStart,
  StringPrototypeSlice,
  StringPrototypeToLowerCase,
} from './primordials.js'

/**
 * Check if string contains only whitespace characters.
 */
function isBlank(str: string): boolean {
  for (let i = 0, { length } = str; i < length; i += 1) {
    const code = StringPrototypeCharCodeAt(str, i)
    // biome-ignore format: newlines
    if (
      !(
        // Whitespace characters according to ECMAScript spec:
        // https://tc39.es/ecma262/#sec-white-space
        // Space
        (
          code === 0x00_20 ||
          // Tab
          code === 0x00_09 ||
          // Line Feed
          code === 0x00_0a ||
          // Vertical Tab
          code === 0x00_0b ||
          // Form Feed
          code === 0x00_0c ||
          // Carriage Return
          code === 0x00_0d ||
          // No-Break Space
          code === 0x00_a0 ||
          // Ogham Space Mark
          code === 0x16_80 ||
          // En Quad
          code === 0x20_00 ||
          // Em Quad
          code === 0x20_01 ||
          // En Space
          code === 0x20_02 ||
          // Em Space
          code === 0x20_03 ||
          // Three-Per-Em Space
          code === 0x20_04 ||
          // Four-Per-Em Space
          code === 0x20_05 ||
          // Six-Per-Em Space
          code === 0x20_06 ||
          // Figure Space
          code === 0x20_07 ||
          // Punctuation Space
          code === 0x20_08 ||
          // Thin Space
          code === 0x20_09 ||
          // Hair Space
          code === 0x20_0a ||
          // Line Separator
          code === 0x20_28 ||
          // Paragraph Separator
          code === 0x20_29 ||
          // Narrow No-Break Space
          code === 0x20_2f ||
          // Medium Mathematical Space
          code === 0x20_5f ||
          // Ideographic Space
          code === 0x30_00 ||
          code === 0xfe_ff
        )
        // Byte Order Mark
      )
    ) {
      return false
    }
  }
  return true
}

/**
 * Check if value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// This regexp is valid as of 2024-08-01
// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const regexSemverNumberedGroups = ObjectFreeze(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
)

/**
 * Check if value is a valid semantic version string.
 */
function isSemverString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    RegExpPrototypeTest(regexSemverNumberedGroups, value)
  )
}

// Intl.Collator is faster than String#localeCompare
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare:
// > When comparing large numbers of strings, such as in sorting large arrays,
// > it is better to create an Intl.Collator object and use the function provided
// > by its compare() method
let _localeCompare: Intl.Collator['compare'] | undefined

/**
 * Perform locale-aware string comparison.
 */
function localeCompare(x: string, y: string): number {
  if (_localeCompare === undefined) {
    // Lazily call new Intl.Collator() because in Node it can take 10-14ms
    _localeCompare = new Intl.Collator().compare
  }
  return _localeCompare(x, y)
}

/**
 * Convert package name to lowercase.
 */
function lowerName(purl: { name: string }): void {
  purl.name = StringPrototypeToLowerCase(purl.name)
}

/**
 * Convert package namespace to lowercase.
 */
function lowerNamespace(purl: { namespace?: string | undefined }): void {
  const { namespace } = purl
  if (typeof namespace === 'string') {
    purl.namespace = StringPrototypeToLowerCase(namespace)
  }
}

/**
 * Convert package version to lowercase.
 */
function lowerVersion(purl: { version?: string | undefined }): void {
  const { version } = purl
  if (typeof version === 'string') {
    purl.version = StringPrototypeToLowerCase(version)
  }
}

/**
 * Replace all dashes with underscores in string.
 */
function replaceDashesWithUnderscores(str: string): string {
  // Replace all "-" with "_"
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
function replaceUnderscoresWithDashes(str: string): string {
  // Replace all "_" with "-"
  let result = ''
  let fromIndex = 0
  let index = 0
  while ((index = StringPrototypeIndexOf(str, '_', fromIndex)) !== -1) {
    result = `${result + StringPrototypeSlice(str, fromIndex, index)}-`
    fromIndex = index + 1
  }
  return fromIndex ? result + StringPrototypeSlice(str, fromIndex) : str
}

/**
 * Test whether a character code is an injection-dangerous character.
 *
 * Detects four classes of dangerous characters:
 *
 * 1. **Shell metacharacters** — command execution, piping, redirection, expansion:
 *    |, &, ;, `, $, <, >, (, ), {, }, \
 *
 * 2. **Quote characters** — break out of quoted contexts in shell, SQL, URLs:
 *    ', "
 *
 * 3. **URL/path delimiters** — fragment injection, comment injection:
 *    #
 *
 * 4. **Whitespace & control characters** — argument splitting, log injection,
 *    terminal escape sequences, null-byte truncation:
 *    0x00-0x1f (all C0 controls including NUL, tab, newline, CR, ESC, etc.)
 *    space (0x20), DEL (0x7f)
 */
function isInjectionCharCode(code: number): boolean {
  // C0 control characters (0x00-0x1f) — includes NUL, tab, newline, CR,
  // ESC (0x1b, terminal escape sequences), and all other control chars.
  // Also catches vertical tab (0x0b), form feed (0x0c), and bell (0x07)
  // which can be used for log injection and terminal manipulation.
  if (code <= 0x1f) {
    return true
  }
  // biome-ignore format: newlines
  if (
    // space — argument splitting in shell contexts
    code === 0x20 ||
    // " — breaks double-quoted shell/SQL/URL contexts
    code === 0x22 ||
    // # — URL fragment injection, shell comments
    code === 0x23 ||
    // $ — shell variable expansion, command substitution $()
    code === 0x24 ||
    // & — shell background execution, URL parameter delimiter
    code === 0x26 ||
    // ' — breaks single-quoted shell/SQL contexts
    code === 0x27 ||
    // ( — shell subshell, command grouping
    code === 0x28 ||
    // ) — shell subshell, command grouping
    code === 0x29 ||
    // ; — shell command separator
    code === 0x3b ||
    // < — shell input redirection, XML/HTML injection
    code === 0x3c ||
    // > — shell output redirection, XML/HTML injection
    code === 0x3e ||
    // \ — shell escape character, path traversal on Windows
    code === 0x5c ||
    // ` — shell command substitution (legacy backtick form)
    code === 0x60 ||
    // { — shell brace expansion
    code === 0x7b ||
    // | — shell pipe
    code === 0x7c ||
    // } — shell brace expansion
    code === 0x7d ||
    // DEL (0x7f) — control character, terminal manipulation
    code === 0x7f
  ) {
    return true
  }
  return false
}

/**
 * Find the first injection character in a string.
 * Returns the character code of the first dangerous character found, or -1.
 *
 * Uses charCode scanning for performance in hot paths. The check is a
 * single pass with no allocation, no regex, and no prototype method calls
 * beyond the captured StringPrototypeCharCodeAt primordial.
 *
 * Null bytes (0x00) are also caught by validateStrings() in validate.ts,
 * but we include them here for defense-in-depth so callers who skip the
 * base validators still get protection.
 */
function findInjectionCharCode(str: string): number {
  for (let i = 0, { length } = str; i < length; i += 1) {
    const code = StringPrototypeCharCodeAt(str, i)
    if (isInjectionCharCode(code)) {
      return code
    }
  }
  return -1
}

/**
 * Check if string contains characters commonly used in injection attacks.
 * Returns true if any dangerous character is found.
 *
 * For detailed information about which character was found, use
 * {@link findInjectionCharCode} instead.
 */
function containsInjectionCharacters(str: string): boolean {
  return findInjectionCharCode(str) !== -1
}

/**
 * Format an injection character code as a human-readable label for error messages.
 * Returns a string like `"|" (0x7c)` for printable chars or `0x1b` for control chars.
 */
function formatInjectionChar(code: number): string {
  const hex = NumberPrototypeToString(code, 16)
  if (code >= 0x20 && code <= 0x7e) {
    return `"${StringFromCharCode(code)}" (0x${hex})`
  }
  return `0x${StringPrototypePadStart(hex, 2, '0')}`
}

/**
 * Remove leading slashes from string.
 */
function trimLeadingSlashes(str: string): string {
  let start = 0
  while (StringPrototypeCharCodeAt(str, start) === 47 /*'/'*/) {
    start += 1
  }
  return start === 0 ? str : StringPrototypeSlice(str, start)
}

export {
  containsInjectionCharacters,
  findInjectionCharCode,
  formatInjectionChar,
  isBlank,
  isNonEmptyString,
  isSemverString,
  localeCompare,
  lowerName,
  lowerNamespace,
  lowerVersion,
  replaceDashesWithUnderscores,
  replaceUnderscoresWithDashes,
  trimLeadingSlashes,
}
