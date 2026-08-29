/**
 * @file Pure Homebrew-formula helpers for brew-publish.mts. Rendering a
 *   Formula/<name>.rb is pure string work given the release coordinates, so
 *   every input arrives as data — no filesystem, no network, no gh — which
 *   keeps the whole surface unit-testable without a tap or a release.
 *   One formula covers every platform the release ships: `on_macos` /
 *   `on_linux` blocks, each with `on_arm` / `on_intel` variants keyed off the
 *   asset-name convention `<name>-<os>-<arch>` (musl folds into the linux
 *   glibc blocks until Homebrew-on-musl is a real target).
 */

export interface FormulaAsset {
  /**
   * 'macos' | 'linux' — the Homebrew on_* block the asset lands in.
   */
  os: 'macos' | 'linux'
  /**
   * 'arm' | 'intel' — Homebrew's arch vocabulary, not the artifact's.
   */
  arch: 'arm' | 'intel'
  /**
   * Asset file name in the GitHub release, e.g. `sfw-macos-arm64`.
   */
  assetName: string
  sha256: string
}

export interface FormulaSpec {
  name: string
  desc: string
  homepage: string
  license: string
  /**
   * Bare version, no leading v — `1.2.3`, never `v1.2.3`.
   */
  version: string
  /**
   * Owner/repo of the GitHub project whose RELEASES host the binaries.
   */
  releaseRepo: string
  /**
   * Release tag the assets hang off — `v1.2.3`.
   */
  tag: string
  assets: FormulaAsset[]
  /**
   * Optional caveats paragraph(s), e.g. an ad-hoc-signature quarantine note.
   */
  caveats?: string | undefined
  /**
   * Shell snippet for the formula's `test do` block.
   */
  testSnippet?: string | undefined
}

/**
 * `sfw` → `Sfw`, `socket-cli` → `SocketCli` (Homebrew class-name rule).
 */
export function formulaClassName(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join('')
}

/**
 * Download URL for one release asset.
 */
export function assetUrl(
  releaseRepo: string,
  tag: string,
  assetName: string,
): string {
  return `https://github.com/${releaseRepo}/releases/download/${tag}/${assetName}`
}

/**
 * Conventional asset name for a platform artifact of `name`.
 */
export function platformAssetName(
  name: string,
  os: 'macos' | 'linux',
  arch: 'arm' | 'intel',
): string {
  const suffix = arch === 'arm' ? 'arm64' : 'x86_64'
  return `${name}-${os}-${suffix}`
}

/**
 * Parse `--sha <platform>=<hex>` pairs into FormulaAssets using the
 * conventional asset names. Platform keys: macos-arm, macos-intel,
 * linux-arm, linux-intel (musl assets are attached by name, not by block).
 */
export function parseAssetChecksums(
  name: string,
  pairs: string[],
): FormulaAsset[] {
  const assets: FormulaAsset[] = []
  for (let i = 0, { length } = pairs; i < length; i += 1) {
    const pair = pairs[i]!
    const eq = pair.indexOf('=')
    if (eq === -1) {
      throw new Error(
        `malformed --sha entry (want <platform>=<sha256>): ${pair}`,
      )
    }
    const platform = pair.slice(0, eq)
    const sha256 = pair.slice(eq + 1)
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`malformed sha256 in --sha ${platform}=…`)
    }
    const [osPart, archPart] = platform.split('-')
    const os =
      osPart === 'macos' ? 'macos' : osPart === 'linux' ? 'linux' : undefined
    const arch =
      archPart === 'arm' ? 'arm' : archPart === 'intel' ? 'intel' : undefined
    if (!os || !arch) {
      throw new Error(
        `unknown --sha platform "${platform}" (want macos-arm|macos-intel|linux-arm|linux-intel)`,
      )
    }
    assets.push({
      os,
      arch,
      assetName: platformAssetName(name, os, arch),
      sha256,
    })
  }
  return assets
}

function renderOsBlock(
  os: 'macos' | 'linux',
  assets: FormulaAsset[],
  releaseRepo: string,
  tag: string,
): string {
  const lines = [`  on_${os} do`]
  for (const arch of ['arm', 'intel'] as const) {
    const asset = assets.find(a => a.os === os && a.arch === arch)
    if (!asset) {
      continue
    }
    lines.push(
      `    on_${arch} do`,
      `      url "${assetUrl(releaseRepo, tag, asset.assetName)}"`,
      `      sha256 "${asset.sha256}"`,
      `    end`,
    )
  }
  lines.push('  end')
  return lines.join('\n')
}

/**
 * Render the full Formula/<name>.rb. Asset order is stable (macos then
 * linux, arm before intel) so regenerating a tag produces a byte-identical
 * file when nothing moved — the tap bump stays diff-quiet.
 */
export function renderFormula(spec: FormulaSpec): string {
  const className = formulaClassName(spec.name)
  const blocks: string[] = []
  if (spec.assets.some(a => a.os === 'macos')) {
    blocks.push(renderOsBlock('macos', spec.assets, spec.releaseRepo, spec.tag))
  }
  if (spec.assets.some(a => a.os === 'linux')) {
    blocks.push(renderOsBlock('linux', spec.assets, spec.releaseRepo, spec.tag))
  }

  const caveats = spec.caveats
    ? `\n  def caveats\n    <<~EOS\n${spec.caveats
        .split(/\r?\n/)
        .map(l => `      ${l}`)
        .join('\n')}\n    EOS\n  end\n`
    : ''

  const testSnippet =
    spec.testSnippet ??
    `assert_match "", shell_output("#{bin}/#{bin.children.first} --help")`

  return `class ${className} < Formula
  desc "${spec.desc}"
  homepage "${spec.homepage}"
  version "${spec.version}"
  license "${spec.license}"

${blocks.join('\n\n')}

  def install
    bin.install Dir["${spec.name}-*"].first => "${spec.name}"
  end
${caveats}
  test do
    ${testSnippet}
  end
end
`
}
