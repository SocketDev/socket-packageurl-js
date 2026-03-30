/**
 * @fileoverview Package URL type-specific normalization and validation rules for different package ecosystems.
 *
 * This module provides centralized access to type-specific normalize and validate functions
 * from individual type modules. Each package ecosystem (npm, pypi, maven, etc.) has its own
 * module in the purl-types/ directory with specific rules for namespace, name, version
 * normalization and validation.
 */
import { PurlInjectionError } from './error.js'
import { createHelpersNamespaceObject } from './helpers.js'
import { findInjectionCharCode, formatInjectionChar } from './strings.js'
import { normalize as alpmNormalize } from './purl-types/alpm.js'
import { normalize as apkNormalize } from './purl-types/apk.js'
import {
  normalize as bazelNormalize,
  validate as bazelValidate,
} from './purl-types/bazel.js'
import {
  normalize as bitbucketNormalize,
  validate as bitbucketValidate,
} from './purl-types/bitbucket.js'
import { normalize as bitnamiNormalize } from './purl-types/bitnami.js'
import { validate as cargoValidate } from './purl-types/cargo.js'
import { validate as cocoaodsValidate } from './purl-types/cocoapods.js'
import { normalize as composerNormalize } from './purl-types/composer.js'
import { validate as conanValidate } from './purl-types/conan.js'
import {
  normalize as condaNormalize,
  validate as condaValidate,
} from './purl-types/conda.js'
import { validate as cpanValidate } from './purl-types/cpan.js'
import { validate as cranValidate } from './purl-types/cran.js'
import { normalize as debNormalize } from './purl-types/deb.js'
import {
  normalize as dockerNormalize,
  validate as dockerValidate,
} from './purl-types/docker.js'
import { validate as gemValidate } from './purl-types/gem.js'
import { normalize as genericNormalize } from './purl-types/generic.js'
import {
  normalize as githubNormalize,
  validate as githubValidate,
} from './purl-types/github.js'
import {
  normalize as gitlabNormalize,
  validate as gitlabValidate,
} from './purl-types/gitlab.js'
import { validate as golangValidate } from './purl-types/golang.js'
import {
  normalize as hexNormalize,
  validate as hexValidate,
} from './purl-types/hex.js'
import { normalize as huggingfaceNormalize } from './purl-types/huggingface.js'
import {
  normalize as juliaNormalize,
  validate as juliaValidate,
} from './purl-types/julia.js'
import { normalize as luarocksNormalize } from './purl-types/luarocks.js'
import { validate as mavenValidate } from './purl-types/maven.js'
import {
  normalize as mlflowNormalize,
  validate as mlflowValidate,
} from './purl-types/mlflow.js'
import {
  normalize as npmNormalize,
  validate as npmValidate,
} from './purl-types/npm.js'
import { validate as nugetValidate } from './purl-types/nuget.js'
import {
  normalize as ociNormalize,
  validate as ociValidate,
} from './purl-types/oci.js'
import { validate as opamValidate } from './purl-types/opam.js'
import {
  normalize as otpNormalize,
  validate as otpValidate,
} from './purl-types/otp.js'
import {
  normalize as pubNormalize,
  validate as pubValidate,
} from './purl-types/pub.js'
import {
  normalize as pypiNormalize,
  validate as pypiValidate,
} from './purl-types/pypi.js'
import { normalize as qpkgNormalize } from './purl-types/qpkg.js'
import { normalize as rpmNormalize } from './purl-types/rpm.js'
import { normalize as socketNormalize } from './purl-types/socket.js'
import { validate as swidValidate } from './purl-types/swid.js'
import { validate as swiftValidate } from './purl-types/swift.js'
import { normalize as unknownNormalize } from './purl-types/unknown.js'
import {
  normalize as vscodeExtensionNormalize,
  validate as vscodeExtensionValidate,
} from './purl-types/vscode-extension.js'
import {
  normalize as yoctoNormalize,
  validate as yoctoValidate,
} from './purl-types/yocto.js'

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
const PurlTypNormalizer = (purl: PurlObject): PurlObject => purl

/**
 * Default validator for PURL types without specific validation rules.
 * Rejects injection characters in name and namespace components.
 * This ensures all types (including newly added ones) get injection
 * protection by default — security is opt-out, not opt-in.
 */
function PurlTypeValidator(purl: PurlObject, throws: boolean): boolean {
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
// https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst
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
