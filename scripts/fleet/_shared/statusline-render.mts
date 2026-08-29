/**
 * @file The prebuilt statusline-render binary contract - ONE list of
 *   (platform, arch, libc?) → filename shared by the release-bundle producer,
 *   which stages CI-built binaries under {@link STATUSLINE_RENDER_REL_DIR},
 *   and `statusline-launcher.mts`, which resolves the matching binary at
 *   runtime. Names follow the `statusline-render-<platform>-<arch>[-musl]`
 *   convention the build script produces. The 8 builds mirror
 *   `PACK_APP_TRIPLETS` (including the linux musl split, since perry binaries
 *   link libc dynamically unlike the static dispatch-launcher).
 */

export const STATUSLINE_RENDER_REL_DIR = '.claude/hooks/fleet/_dist/statusline'

export interface StatuslineRender {
  arch: string
  fileName: string
  libc?: string | undefined
  platform: string
}

/**
 * The bundle filename for a (platform, arch, libc?) triple.
 */
export function statuslineRenderFileName(
  platform: string,
  arch: string,
  options: { libc?: string | undefined } = {},
): string {
  const libc = options.libc
  const ext = platform === 'win32' ? '.exe' : ''
  const libcSuffix = libc ? `-${libc}` : ''
  return `statusline-render-${platform}-${arch}${libcSuffix}${ext}`
}

/**
 * The bundle-relative path of a binary, for producers and fetch validators.
 */
export function statuslineRenderRelPath(
  platform: string,
  arch: string,
  options: { libc?: string | undefined } = {},
): string {
  return `${STATUSLINE_RENDER_REL_DIR}/${statuslineRenderFileName(platform, arch, options)}`
}

/**
 * Every binary the release bundle carries. A platform+arch absent here falls
 * back to the Node statusline script (the `statusLine.command` fail-soft).
 */
export const STATUSLINE_RENDER: readonly StatuslineRender[] = [
  {
    arch: 'arm64',
    fileName: statuslineRenderFileName('darwin', 'arm64'),
    platform: 'darwin',
  },
  {
    arch: 'x64',
    fileName: statuslineRenderFileName('darwin', 'x64'),
    platform: 'darwin',
  },
  {
    arch: 'arm64',
    fileName: statuslineRenderFileName('linux', 'arm64'),
    platform: 'linux',
  },
  {
    arch: 'arm64',
    fileName: statuslineRenderFileName('linux', 'arm64', { libc: 'musl' }),
    libc: 'musl',
    platform: 'linux',
  },
  {
    arch: 'x64',
    fileName: statuslineRenderFileName('linux', 'x64'),
    platform: 'linux',
  },
  {
    arch: 'x64',
    fileName: statuslineRenderFileName('linux', 'x64', { libc: 'musl' }),
    libc: 'musl',
    platform: 'linux',
  },
  {
    arch: 'arm64',
    fileName: statuslineRenderFileName('win32', 'arm64'),
    platform: 'win32',
  },
  {
    arch: 'x64',
    fileName: statuslineRenderFileName('win32', 'x64'),
    platform: 'win32',
  },
]

/**
 * The bundle-relative paths of every binary, for the manifest's
 * `generatedPaths` declaration.
 */
export const STATUSLINE_RENDER_MANIFEST_RELS: readonly string[] =
  STATUSLINE_RENDER.map(
    render => `${STATUSLINE_RENDER_REL_DIR}/${render.fileName}`,
  )
