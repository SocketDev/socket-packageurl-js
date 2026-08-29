/**
 * @file URL helpers for the CHANGELOG: normalizing a repository URL to a
 *   canonical GitHub base, and verifying that links in a generated entry
 *   resolve (no 404s). The link-verification technique is learned from
 *   communique (jdx/communique src/links.rs).
 */
const URL_RE = /https?:\/\/[^\s)\]>]+/g
const TRAILING_PUNCT = /[.,;)]+$/

export function changelogRepoUrl(
  repositoryUrl: string | undefined,
): string | undefined {
  if (!repositoryUrl) {
    return undefined
  }
  const m = /github\.com[/:](?<owner>[^/]+)\/(?<repo>[^/.]+)/.exec(
    repositoryUrl,
  )
  if (!m?.groups) {
    return undefined
  }
  return `https://github.com/${m.groups['owner']}/${m.groups['repo']}`
}

export function extractChangelogLinks(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(URL_RE)) {
    found.add(m[0]!.replace(TRAILING_PUNCT, ''))
  }
  return [...found]
}

export async function verifyChangelogLinks(
  text: string,
): Promise<Array<{ url: string; status: string }>> {
  const urls = extractChangelogLinks(text)
  const broken: Array<{ url: string; status: string }> = []
  for (let i = 0, { length } = urls; i < length; i += 1) {
    const url = urls[i]!
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- link verification needs HEAD + redirect control
      let res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
      })
      if (res.status === 405) {
        // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- fallback GET for 405
        res = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
        })
      }
      if (res.status === 404) {
        broken.push({ url, status: '404' })
      }
    } catch (e) {
      broken.push({ url, status: String((e as Error).message) })
    } finally {
      clearTimeout(timer)
    }
  }
  return broken
}
