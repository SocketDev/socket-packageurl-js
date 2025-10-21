/**
 * @fileoverview String utility functions for PURL processing.
 * Includes whitespace detection, semver validation, locale comparison, and character replacement.
 */

/**
 * Check if string contains only whitespace characters.
 */
function isBlank(str: string): boolean {
  for (let i = 0, { length } = str; i < length; i += 1) {
    const code = str.charCodeAt(i)
    // biome-ignore format: newlines
    if (
      !(
        // Whitespace characters according to ECMAScript spec:
        // https://tc39.es/ecma262/#sec-white-space
        (
          // Space
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
        // Byte Order Mark
        )
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
const regexSemverNumberedGroups =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/**
 * Check if value is a valid semantic version string.
 */
function isSemverString(value: unknown): value is string {
  return typeof value === 'string' && regexSemverNumberedGroups.test(value)
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
  purl.name = purl.name.toLowerCase()
}

/**
 * Convert package namespace to lowercase.
 */
function lowerNamespace(purl: { namespace?: string | undefined }): void {
  const { namespace } = purl
  if (typeof namespace === 'string') {
    purl.namespace = namespace.toLowerCase()
  }
}

/**
 * Convert package version to lowercase.
 */
function lowerVersion(purl: { version?: string | undefined }): void {
  const { version } = purl
  if (typeof version === 'string') {
    purl.version = version.toLowerCase()
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
  while ((index = str.indexOf('-', fromIndex)) !== -1) {
    result = `${result + str.slice(fromIndex, index)}_`
    fromIndex = index + 1
  }
  return fromIndex ? result + str.slice(fromIndex) : str
}

/**
 * Replace all underscores with dashes in string.
 */
function replaceUnderscoresWithDashes(str: string): string {
  // Replace all "_" with "-"
  let result = ''
  let fromIndex = 0
  let index = 0
  while ((index = str.indexOf('_', fromIndex)) !== -1) {
    result = `${result + str.slice(fromIndex, index)}-`
    fromIndex = index + 1
  }
  return fromIndex ? result + str.slice(fromIndex) : str
}

/**
 * Remove leading slashes from string.
 */
function trimLeadingSlashes(str: string): string {
  let start = 0
  while (str.charCodeAt(start) === 47 /*'/'*/) {
    start += 1
  }
  return start === 0 ? str : str.slice(start)
}

export {
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
