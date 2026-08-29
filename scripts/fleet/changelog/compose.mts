/**
 * @file Build, union, and promote the CHANGELOG entry from Conventional
 *   Commits. The release section is composed from BOTH bullet sources: the
 *   commit-derived bullets and the hand-written bullets accrued under
 *   `## [Unreleased]`, merged under their matching Added/Changed/Fixed
 *   headings with exact-duplicate lines collapsed.
 */
import {
  hasListItem,
  headingLines,
  listItemsByHeading,
} from '../lib/markdown-ast.mts'
import {
  renderBullet,
  renderSectionMap,
  TYPE_TO_SECTION,
  unreleasedRange,
} from './render.mts'
import { changelogInternalScope, isChangelogDevScope } from './scopes.mts'
import { isPrereleaseVersion } from './commits.mts'
import { extractChangelogVersionSection } from './sections.mts'
import type { ConventionalCommit } from './commits.mts'

export function changelogHeading(
  version: string,
  date: string,
  repoUrl: string | undefined,
): string {
  return repoUrl && !isPrereleaseVersion(version)
    ? `## [${version}](${repoUrl}/releases/tag/v${version}) - ${date}`
    : `## ${version} - ${date}`
}

export function composeChangelogSectionFromCommits(config: {
  commits: readonly ConventionalCommit[]
  date: string
  repoUrl: string | undefined
  version: string
  heading?: string | undefined
}): string {
  const {
    commits,
    date,
    heading: headingOverride,
    repoUrl,
    version,
  } = {
    __proto__: null,
    ...config,
  } as {
    commits: readonly ConventionalCommit[]
    date: string
    heading?: string | undefined
    repoUrl: string | undefined
    version: string
  }
  const heading = headingOverride ?? changelogHeading(version, date, repoUrl)
  const bySection = new Map<string, string[]>()
  for (let i = 0, { length } = commits; i < length; i += 1) {
    const commit = commits[i]!
    const rawSection =
      TYPE_TO_SECTION[commit.type] ?? (commit.breaking ? 'Changed' : undefined)
    if (!rawSection) {
      continue
    }
    const section = isChangelogDevScope(commit.scope)
      ? changelogInternalScope
      : rawSection
    const bullets = bySection.get(section) ?? []
    bullets.push(renderBullet(commit))
    bySection.set(section, bullets)
  }
  return renderSectionMap(heading, bySection)
}

export const UNRELEASED_HEADING = '## [Unreleased]'

export function changelogSectionHasEntries(section: string): boolean {
  return hasListItem(section)
}

export function withChangelogEntry(section: string, bullet: string): string {
  return `${section}\n\n### Changed\n\n- ${bullet}`
}

export function parseChangelogSectionBullets(
  section: string,
): Map<string, string[]> {
  return listItemsByHeading(section, 3)
}

export function unionChangelogSections(
  heading: string,
  primary: string,
  secondary: string,
): string {
  const merged = new Map<string, string[]>()
  for (const [section, bullets] of parseChangelogSectionBullets(primary)) {
    merged.set(section, [...bullets])
  }
  for (const [section, bullets] of parseChangelogSectionBullets(secondary)) {
    const arr = merged.get(section) ?? []
    for (const bullet of bullets) {
      if (!arr.includes(bullet)) {
        arr.push(bullet)
      }
    }
    merged.set(section, arr)
  }
  return renderSectionMap(heading, merged)
}

export function mergeChangelogUnreleased(
  changelog: string,
  entriesSection: string,
): string {
  const incoming = parseChangelogSectionBullets(entriesSection)
  let incomingCount = 0
  for (const bullets of incoming.values()) {
    incomingCount += bullets.length
  }
  if (incomingCount === 0) {
    return changelog
  }
  const lines = changelog.split(/\r?\n/)
  const range = unreleasedRange(lines, UNRELEASED_HEADING)
  let before: string[]
  let after: string[]
  let existingBody = ''
  if (!range) {
    const firstVersion = headingLines(changelog, 2)[0] ?? -1
    if (firstVersion === -1) {
      before = lines
      after = []
    } else {
      before = lines.slice(0, firstVersion)
      after = lines.slice(firstVersion)
    }
  } else {
    existingBody = lines.slice(range.start + 1, range.end).join('\n')
    before = lines.slice(0, range.start)
    after = lines.slice(range.end)
  }
  const block = unionChangelogSections(
    UNRELEASED_HEADING,
    entriesSection,
    existingBody,
  )
  const beforeText = before.join('\n').replace(/\s*$/u, '')
  const afterText = after.join('\n').replace(/^\s*/u, '')
  return `${beforeText}\n\n${block}\n\n${afterText}`
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/\s+$/u, '\n')
}

export function promoteChangelogUnreleasedSection(
  changelog: string,
  versionHeading: string,
): { changelog: string; section: string } | undefined {
  const lines = changelog.split(/\r?\n/)
  const range = unreleasedRange(lines, UNRELEASED_HEADING)
  if (!range) {
    return undefined
  }
  const body = lines
    .slice(range.start + 1, range.end)
    .join('\n')
    .trim()
  if (!changelogSectionHasEntries(body)) {
    return undefined
  }
  const remainder = [...lines.slice(0, range.start), ...lines.slice(range.end)]
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/\s+$/u, '\n')
  return { changelog: remainder, section: `${versionHeading}\n\n${body}` }
}

export function composeChangelogReleaseSection(config: {
  changelog: string
  commits: readonly ConventionalCommit[]
  date: string
  repoUrl: string | undefined
  version: string
  versionHeading: string
}): { baseChangelog: string; promotedUnreleased: boolean; section: string } {
  const { changelog, commits, date, repoUrl, version, versionHeading } = {
    __proto__: null,
    ...config,
  } as {
    changelog: string
    commits: readonly ConventionalCommit[]
    date: string
    repoUrl: string | undefined
    version: string
    versionHeading: string
  }
  const derived = composeChangelogSectionFromCommits({
    commits,
    date,
    heading: versionHeading,
    repoUrl,
    version,
  })
  const existing = extractChangelogVersionSection(changelog, version)
  const heading =
    existing?.date !== undefined
      ? changelogHeading(version, existing.date, repoUrl)
      : versionHeading
  const withoutExisting = existing?.changelog ?? changelog
  const derivedSection =
    heading === versionHeading
      ? derived
      : composeChangelogSectionFromCommits({
          commits,
          date,
          heading,
          repoUrl,
          version,
        })
  let section = derivedSection
  if (existing) {
    section = unionChangelogSections(heading, section, existing.section)
  }
  const promoted = promoteChangelogUnreleasedSection(withoutExisting, heading)
  if (!promoted) {
    return {
      baseChangelog: withoutExisting,
      promotedUnreleased: false,
      section,
    }
  }
  return {
    baseChangelog: promoted.changelog,
    promotedUnreleased: true,
    section: unionChangelogSections(heading, section, promoted.section),
  }
}
