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
import { findInjectionCharCode, formatInjectionChar } from './strings.mjs'
import { normalize as alpmNormalize } from './purl-types/alpm.mjs'
import { normalize as apkNormalize } from './purl-types/apk.mjs'
import {
  normalize as bazelNormalize,
  validate as bazelValidate,
} from './purl-types/bazel.mjs'
import {
  normalize as bitbucketNormalize,
  validate as bitbucketValidate,
} from './purl-types/bitbucket.mjs'
import { normalize as bitnamiNormalize } from './purl-types/bitnami.mjs'
import { validate as cargoValidate } from './purl-types/cargo.mjs'
import { validate as cocoaodsValidate } from './purl-types/cocoapods.mjs'
import { normalize as composerNormalize } from './purl-types/composer.mjs'
import { validate as conanValidate } from './purl-types/conan.mjs'
import {
  normalize as condaNormalize,
  validate as condaValidate,
} from './purl-types/conda.mjs'
import { validate as cpanValidate } from './purl-types/cpan.mjs'
import { validate as cranValidate } from './purl-types/cran.mjs'
import { normalize as debNormalize } from './purl-types/deb.mjs'
import {
  normalize as dockerNormalize,
  validate as dockerValidate,
} from './purl-types/docker.mjs'
import { validate as gemValidate } from './purl-types/gem.mjs'
import { normalize as genericNormalize } from './purl-types/generic.mjs'
import {
  normalize as githubNormalize,
  validate as githubValidate,
} from './purl-types/github.mjs'
import {
  normalize as gitlabNormalize,
  validate as gitlabValidate,
} from './purl-types/gitlab.mjs'
import { validate as golangValidate } from './purl-types/golang.mjs'
import {
  normalize as hexNormalize,
  validate as hexValidate,
} from './purl-types/hex.mjs'
import { normalize as huggingfaceNormalize } from './purl-types/huggingface.mjs'
import {
  normalize as juliaNormalize,
  validate as juliaValidate,
} from './purl-types/julia.mjs'
import { normalize as luarocksNormalize } from './purl-types/luarocks.mjs'
import { validate as mavenValidate } from './purl-types/maven.mjs'
import {
  normalize as mlflowNormalize,
  validate as mlflowValidate,
} from './purl-types/mlflow.mjs'
import {
  normalize as npmNormalize,
  validate as npmValidate,
} from './purl-types/npm.mjs'
import { validate as nugetValidate } from './purl-types/nuget.mjs'
import {
  normalize as ociNormalize,
  validate as ociValidate,
} from './purl-types/oci.mjs'
import { validate as opamValidate } from './purl-types/opam.mjs'
import {
  normalize as otpNormalize,
  validate as otpValidate,
} from './purl-types/otp.mjs'
import {
  normalize as pubNormalize,
  validate as pubValidate,
} from './purl-types/pub.mjs'
import {
  normalize as pypiNormalize,
  validate as pypiValidate,
} from './purl-types/pypi.mjs'
import { normalize as qpkgNormalize } from './purl-types/qpkg.mjs'
import { normalize as rpmNormalize } from './purl-types/rpm.mjs'
import { normalize as socketNormalize } from './purl-types/socket.mjs'
import { validate as swidValidate } from './purl-types/swid.mjs'
import { validate as swiftValidate } from './purl-types/swift.mjs'
import { normalize as unknownNormalize } from './purl-types/unknown.mjs'
import {
  normalize as vscodeExtensionNormalize,
  validate as vscodeExtensionValidate,
} from './purl-types/vscode-extension.mjs'
import {
  normalize as yoctoNormalize,
  validate as yoctoValidate,
} from './purl-types/yocto.mjs'

interface PurlObject {
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
function PurlTypNormalizer(purl: PurlObject) {
  return purl
}

/**
 * Default validator for PURL types without specific validation rules. Rejects
 * injection characters in `name` and `namespace` components. This ensures all
 * types (including newly added ones) get injection protection by default —
 * security is opt-out, not opt-in.
 */
export function PurlTypeValidator(purl: PurlObject, throws: boolean): boolean {
  const type = purl.type ?? 'unknown'
  if (typeof purl.namespace === 'string') {
    const nsCode = findInjectionCharCode(purl.namespace)
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
  const nameCode = findInjectionCharCode(purl.name)
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
      bazel: bazelNormalize,
      bitbucket: bitbucketNormalize,
      bitnami: bitnamiNormalize,
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
