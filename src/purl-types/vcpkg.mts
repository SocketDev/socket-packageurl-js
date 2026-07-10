/**
 * @file Vcpkg (C/C++ package manager) PURL validation.
 *   https://github.com/package-url/purl-spec/blob/main/types/vcpkg-definition.json
 *   A vcpkg port name like `boost-asio` is a single name component — the spec
 *   prohibits a namespace (`pkg:vcpkg/boost/asio` must fail rather than parse
 *   as namespace + name). No normalize step: port names are already lowercase
 *   kebab-case by vcpkg's own registry grammar and the definition carries no
 *   normalization rules. The `port_version` / `repository_revision` / `triplet`
 *   qualifiers are optional and flow through generic qualifier handling.
 */

import { validateEmptyByType, validateNoInjectionByType } from '../validate.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Validate vcpkg package URL. Vcpkg packages must not have a `namespace`;
 * `name` must not contain injection characters.
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (!validateEmptyByType('vcpkg', 'namespace', purl.namespace, { throws })) {
    return false
  }
  if (!validateNoInjectionByType('vcpkg', 'name', purl.name, { throws })) {
    return false
  }
  return true
}
