/**
 * @fileoverview Safe references to built-in functions and constructors.
 *
 * Captures references to JavaScript built-ins at module load time, before
 * user code can tamper with prototypes or globals. All consumers should
 * import from this module instead of using globals directly.
 *
 * Follows Node.js internal primordials conventions:
 * - Static methods: ObjectKeys, ArrayIsArray, JSONParse, etc.
 * - Prototype methods: StringPrototypeSlice, ArrayPrototypePush, etc.
 * - Constructors: MapCtor, SetCtor, URLCtor, etc.
 *
 * IMPORTANT: Do not use destructuring on globalThis or Reflect here.
 * tsgo has a bug that incorrectly transpiles destructured exports.
 * See: https://github.com/SocketDev/socket-packageurl-js/issues/3
 *
 * @see https://github.com/nicolo-ribaudo/tc39-proposal-primordials
 * @see https://github.com/nicolo-ribaudo/tc39-proposal-primordials/blob/main/polyfill.mjs
 * @see https://github.com/nicolo-ribaudo/tc39-proposal-primordials/blob/main/polyfill.js
 * @see https://github.com/nicolo-ribaudo/tc39-proposal-primordials/blob/main/README.md
 * @see https://github.com/nicolo-ribaudo/tc39-proposal-primordials/blob/main/playground.mjs
 * @see https://github.com/nicolo-ribaudo/tc39-proposal-primordials/blob/main/tests.mjs
 */

// ─── uncurryThis ───────────────────────────────────────────────────────
// Mirrors Node.js internal/per_context/primordials.js:
//   const { apply, bind, call } = Function.prototype
//   const uncurryThis = bind.bind(call)
const { apply, bind, call } = Function.prototype
const uncurryThis = bind.bind(call) as <T, A extends readonly unknown[], R>(
  fn: (this: T, ...args: A) => R,
) => (self: T, ...args: A) => R
const applyBind = bind.bind(apply) as <T, A extends readonly unknown[], R>(
  fn: (this: T, ...args: A) => R,
) => (self: T, args: A) => R

// ─── Constructors ──────────────────────────────────────────────────────
const MapCtor: MapConstructor = Map
const SetCtor: SetConstructor = Set
const URLCtor: typeof URL = URL
const URLSearchParamsCtor: typeof URLSearchParams = URLSearchParams
const WeakSetCtor: WeakSetConstructor = WeakSet

// ─── Global functions ──────────────────────────────────────────────────
const encodeComponent = globalThis.encodeURIComponent
const decodeComponent = globalThis.decodeURIComponent

// ─── JSON ──────────────────────────────────────────────────────────────
const JSONParse = JSON.parse
const JSONStringify = JSON.stringify

// ─── Object ────────────────────────────────────────────────────────────
const ObjectCreate = Object.create
const ObjectEntries = Object.entries
const ObjectFromEntries = Object.fromEntries
const ObjectFreeze = Object.freeze
const ObjectIsFrozen = Object.isFrozen
const ObjectKeys = Object.keys
const ObjectValues = Object.values

// ─── Array ─────────────────────────────────────────────────────────────
const ArrayIsArray = Array.isArray
const ArrayPrototypeAt = uncurryThis(Array.prototype.at)
const ArrayPrototypeFilter = uncurryThis(Array.prototype.filter)
const ArrayPrototypeFlatMap = uncurryThis(Array.prototype.flatMap)
const ArrayPrototypeIncludes = uncurryThis(Array.prototype.includes)
const ArrayPrototypeJoin = uncurryThis(Array.prototype.join)
const ArrayPrototypeMap = uncurryThis(Array.prototype.map)
const ArrayPrototypePush = uncurryThis(Array.prototype.push) as <T>(
  self: T[],
  ...items: T[]
) => number
const ArrayPrototypeSlice = uncurryThis(Array.prototype.slice)
const ArrayPrototypeSome = uncurryThis(Array.prototype.some)
const ArrayPrototypeToSorted = uncurryThis(Array.prototype.toSorted)

// ─── Reflect ───────────────────────────────────────────────────────────
const ReflectApply = Reflect.apply
const ReflectDefineProperty = Reflect.defineProperty
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor
const ReflectOwnKeys = Reflect.ownKeys
const ReflectSetPrototypeOf = Reflect.setPrototypeOf

// ─── Number ───────────────────────────────────────────────────────────
const NumberPrototypeToString = uncurryThis(Number.prototype.toString)

// ─── RegExp ────────────────────────────────────────────────────────────
const RegExpPrototypeExec = uncurryThis(RegExp.prototype.exec)
const RegExpPrototypeTest = uncurryThis(RegExp.prototype.test)

// ─── String ────────────────────────────────────────────────────────────
const StringFromCharCode = String.fromCharCode
const StringPrototypeCharCodeAt = uncurryThis(String.prototype.charCodeAt)
const StringPrototypeEndsWith = uncurryThis(String.prototype.endsWith)
const StringPrototypeIncludes = uncurryThis(String.prototype.includes)
const StringPrototypeIndexOf = uncurryThis(String.prototype.indexOf)
const StringPrototypeLastIndexOf = uncurryThis(String.prototype.lastIndexOf)
const StringPrototypeReplace = uncurryThis(String.prototype.replace)
const StringPrototypeReplaceAll = uncurryThis(
  String.prototype.replaceAll as (
    this: string,
    searchValue: string,
    replaceValue: string,
  ) => string,
)
const StringPrototypePadStart = uncurryThis(String.prototype.padStart)
const StringPrototypeSlice = uncurryThis(String.prototype.slice)
const StringPrototypeSplit = uncurryThis(String.prototype.split)
const StringPrototypeStartsWith = uncurryThis(String.prototype.startsWith)
const StringPrototypeToLowerCase = uncurryThis(String.prototype.toLowerCase)
const StringPrototypeToUpperCase = uncurryThis(String.prototype.toUpperCase)
const StringPrototypeTrim = uncurryThis(String.prototype.trim)

export {
  applyBind,
  ArrayIsArray,
  ArrayPrototypeAt,
  ArrayPrototypeFilter,
  ArrayPrototypeFlatMap,
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  ArrayPrototypeSome,
  ArrayPrototypeToSorted,
  decodeComponent,
  encodeComponent,
  JSONParse,
  JSONStringify,
  MapCtor,
  ObjectCreate,
  ObjectEntries,
  NumberPrototypeToString,
  ObjectFromEntries,
  ObjectFreeze,
  ObjectIsFrozen,
  ObjectKeys,
  ObjectValues,
  ReflectApply,
  ReflectDefineProperty,
  ReflectGetOwnPropertyDescriptor,
  ReflectOwnKeys,
  ReflectSetPrototypeOf,
  RegExpPrototypeExec,
  RegExpPrototypeTest,
  SetCtor,
  StringFromCharCode,
  StringPrototypeCharCodeAt,
  StringPrototypeEndsWith,
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeReplace,
  StringPrototypeReplaceAll,
  StringPrototypePadStart,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
  StringPrototypeToUpperCase,
  StringPrototypeTrim,
  uncurryThis,
  URLCtor,
  URLSearchParamsCtor,
  WeakSetCtor,
}
