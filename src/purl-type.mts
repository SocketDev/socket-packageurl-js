/**
 * @file Package URL type-specific normalization and validation rules for
 *   different package ecosystems. This module provides centralized access to
 *   type-specific `normalize` and `validate` functions from individual type
 *   modules. Each package ecosystem (`npm`, `pypi`, `maven`, etc.) has its own
 *   module in the `purl-types/` directory with specific rules for `namespace`,
 *   `name`, `version` normalization and validation.
 */
import { PurlInjectionError } from './error.mjs'
import { createHelpersNamespaceObject } from './helpers.mjs'
import { findShellInjectionCharCode, formatInjectionChar } from './strings.mjs'
import { normalize as alpmNormalize } from './purl-types/alpm.mjs'
import { normalize as apkNormalize } from './purl-types/apk.mjs'
import { bazelValidate } from './purl-types/bazel.mjs'
import {
  bitbucketValidate,
  normalize as bitbucketNormalize,
} from './purl-types/bitbucket.mjs'
import { normalize as bitnamiNormalize } from './purl-types/bitnami.mjs'
import { cargoValidate } from './purl-types/cargo.mjs'
import {
  chromeExtensionValidate,
  normalize as chromeExtensionNormalize,
} from './purl-types/chrome-extension.mjs'
import { cocoaodsValidate } from './purl-types/cocoapods.mjs'
import { normalize as composerNormalize } from './purl-types/composer.mjs'
import { conanValidate } from './purl-types/conan.mjs'
import {
  condaValidate,
  normalize as condaNormalize,
} from './purl-types/conda.mjs'
import { cpanValidate } from './purl-types/cpan.mjs'
import { cranValidate } from './purl-types/cran.mjs'
import { normalize as debNormalize } from './purl-types/deb.mjs'
import {
  dockerValidate,
  normalize as dockerNormalize,
} from './purl-types/docker.mjs'
import { gemValidate } from './purl-types/gem.mjs'
import { normalize as genericNormalize } from './purl-types/generic.mjs'
import {
  githubValidate,
  normalize as githubNormalize,
} from './purl-types/github.mjs'
import {
  gitlabValidate,
  normalize as gitlabNormalize,
} from './purl-types/gitlab.mjs'
import { golangValidate } from './purl-types/golang.mjs'
import { hackageValidate } from './purl-types/hackage.mjs'
import { hexValidate, normalize as hexNormalize } from './purl-types/hex.mjs'
import { normalize as huggingfaceNormalize } from './purl-types/huggingface.mjs'
import {
  juliaValidate,
  normalize as juliaNormalize,
} from './purl-types/julia.mjs'
import { normalize as luarocksNormalize } from './purl-types/luarocks.mjs'
import { mavenValidate } from './purl-types/maven.mjs'
import {
  mlflowValidate,
  normalize as mlflowNormalize,
} from './purl-types/mlflow.mjs'
import { normalize as npmNormalize, npmValidate } from './purl-types/npm.mjs'
import { nugetValidate } from './purl-types/nuget.mjs'
import { normalize as ociNormalize, ociValidate } from './purl-types/oci.mjs'
import { opamValidate } from './purl-types/opam.mjs'
import { normalize as otpNormalize, otpValidate } from './purl-types/otp.mjs'
import { normalize as pubNormalize, pubValidate } from './purl-types/pub.mjs'
import { normalize as pypiNormalize, pypiValidate } from './purl-types/pypi.mjs'
import { normalize as qpkgNormalize } from './purl-types/qpkg.mjs'
import { normalize as rpmNormalize } from './purl-types/rpm.mjs'
import { normalize as socketNormalize } from './purl-types/socket.mjs'
import { swidValidate } from './purl-types/swid.mjs'
import { swiftValidate } from './purl-types/swift.mjs'
import { normalize as unknownNormalize } from './purl-types/unknown.mjs'
import { vcpkgValidate } from './purl-types/vcpkg.mjs'
import {
  normalize as vscodeExtensionNormalize,
  vscodeExtensionValidate,
} from './purl-types/vscode-extension.mjs'
import {
  normalize as yoctoNormalize,
  yoctoValidate,
} from './purl-types/yocto.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Default normalizer for PURL types without specific normalization rules.
 */
export function PurlTypNormalizer(purl: PurlObject) {
  return purl
}

/**
 * Default validator for PURL types without specific validation rules. Rejects
 * injection characters in `name` and `namespace` components. This ensures all
 * types (including newly added ones) get injection protection by default —
 * security is opt-out, not opt-in.
 */
export function PurlTypeValidator(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  const type = purl.type ?? 'unknown'
  if (typeof purl.namespace === 'string') {
    const nsCode = findShellInjectionCharCode(purl.namespace)
    if (nsCode !== -1) {
      if (throws) {
        throw new PurlInjectionError(
          type,
          'namespace',
          nsCode,
          formatInjectionChar(nsCode),
        )
      }
      return false
    }
  }
  const nameCode = findShellInjectionCharCode(purl.name)
  if (nameCode !== -1) {
    if (throws) {
      throw new PurlInjectionError(
        type,
        'name',
        nameCode,
        formatInjectionChar(nameCode),
      )
    }
    return false
  }
  return true
}

// PURL types:
// https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst
const PurlType = createHelpersNamespaceObject(
  {
    normalize: {
      alpm: alpmNormalize,
      apk: apkNormalize,
      bitbucket: bitbucketNormalize,
      bitnami: bitnamiNormalize,
      'chrome-extension': chromeExtensionNormalize,
      composer: composerNormalize,
      conda: condaNormalize,
      deb: debNormalize,
      docker: dockerNormalize,
      generic: genericNormalize,
      github: githubNormalize,
      gitlab: gitlabNormalize,
      hex: hexNormalize,
      huggingface: huggingfaceNormalize,
      julia: juliaNormalize,
      luarocks: luarocksNormalize,
      mlflow: mlflowNormalize,
      npm: npmNormalize,
      oci: ociNormalize,
      otp: otpNormalize,
      pub: pubNormalize,
      pypi: pypiNormalize,
      qpkg: qpkgNormalize,
      rpm: rpmNormalize,
      socket: socketNormalize,
      unknown: unknownNormalize,
      'vscode-extension': vscodeExtensionNormalize,
      yocto: yoctoNormalize,
    },
    validate: {
      bazel: bazelValidate,
      bitbucket: bitbucketValidate,
      cargo: cargoValidate,
      'chrome-extension': chromeExtensionValidate,
      cocoapods: cocoaodsValidate,
      conda: condaValidate,
      conan: conanValidate,
      cpan: cpanValidate,
      cran: cranValidate,
      docker: dockerValidate,
      gem: gemValidate,
      github: githubValidate,
      gitlab: gitlabValidate,
      golang: golangValidate,
      hackage: hackageValidate,
      hex: hexValidate,
      julia: juliaValidate,
      maven: mavenValidate,
      mlflow: mlflowValidate,
      npm: npmValidate,
      nuget: nugetValidate,
      oci: ociValidate,
      opam: opamValidate,
      otp: otpValidate,
      pub: pubValidate,
      pypi: pypiValidate,
      swift: swiftValidate,
      swid: swidValidate,
      vcpkg: vcpkgValidate,
      'vscode-extension': vscodeExtensionValidate,
      yocto: yoctoValidate,
    },
  },
  {
    normalize: PurlTypNormalizer,
    validate: PurlTypeValidator,
  },
)

export { PurlType }
