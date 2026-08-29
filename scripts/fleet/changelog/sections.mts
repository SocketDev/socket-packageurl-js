/**
 * @file The CHANGELOG section primitives: locating, listing, removing, and
 *   inserting a version's section. Pure string transforms over CHANGELOG text.
 */
import { documentHeadings, headingLines } from '../lib/markdown-ast.mts'
import type { MarkdownHeading } from '../lib/markdown-ast.mts'

// The version a ## heading names: optional [ and v, then semver core + prerelease.
// oxlint-disable-next-line socket/prefer-non-capturing-group -- capture used via .exec(...)?.[1]
const HEADING_VERSION_RE = /^\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/

function findChangelogSectionHeadings(changelog: string): MarkdownHeading[] {
  return documentHeadings(changelog).filter(heading => heading.depth === 2)
}

function headingNamesVersion(text: string, version: string): boolean {
  const rest = text.trim().replace(/^\[/, '').replace(/^v/, '')
  return rest.startsWith(version) && !/^[0-9.]/.test(rest.slice(version.length))
}

function versionSectionRange(
  changelog: string,
  version: string,
): { end: number; headingText: string; start: number } | undefined {
  const headings = findChangelogSectionHeadings(changelog)
  const at = headings.findIndex(heading =>
    headingNamesVersion(heading.text, version),
  )
  if (at === -1) {
    return undefined
  }
  const next = headings[at + 1]
  return {
    end: next ? next.line : changelog.split(/\r?\n/).length,
    headingText: headings[at]!.text,
    start: headings[at]!.line,
  }
}

export function hasChangelogVersionSection(
  changelog: string,
  version: string,
): boolean {
  return findChangelogSectionHeadings(changelog).some(heading =>
    headingNamesVersion(heading.text, version),
  )
}

export function listChangelogVersionSections(changelog: string): string[] {
  const found: string[] = []
  for (const heading of findChangelogSectionHeadings(changelog)) {
    const version = HEADING_VERSION_RE.exec(heading.text)?.[1]
    if (version) {
      found.push(version)
    }
  }
  return found
}

export function removeChangelogVersionSection(
  changelog: string,
  version: string,
): string {
  const range = versionSectionRange(changelog, version)
  if (!range) {
    return changelog
  }
  const lines = changelog.split(/\r?\n/)
  return [...lines.slice(0, range.start), ...lines.slice(range.end)].join('\n')
}

export function extractChangelogVersionSection(
  changelog: string,
  version: string,
):
  | { changelog: string; date: string | undefined; section: string }
  | undefined {
  const range = versionSectionRange(changelog, version)
  if (!range) {
    return undefined
  }
  const lines = changelog.split(/\r?\n/)
  // oxlint-disable-next-line socket/prefer-non-capturing-group -- capture used via .exec(...)?.[1]
  const date = /-\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(range.headingText)?.[1]
  return {
    changelog: [...lines.slice(0, range.start), ...lines.slice(range.end)].join(
      '\n',
    ),
    date,
    section: lines.slice(range.start, range.end).join('\n').trimEnd(),
  }
}

export function dropChangelogUnreleasedSections(
  changelog: string,
  isDraft: (version: string) => boolean,
): { dropped: string[]; text: string } {
  const dropped: string[] = []
  let text = changelog
  for (const version of listChangelogVersionSections(changelog)) {
    if (isDraft(version)) {
      dropped.push(version)
      text = removeChangelogVersionSection(text, version)
    }
  }
  return { dropped, text }
}

export function insertChangelogVersionSection(
  existing: string,
  section: string,
): string {
  const sectionHeading = findChangelogSectionHeadings(section)[0]
  const sectionVersion = sectionHeading
    ? HEADING_VERSION_RE.exec(sectionHeading.text)?.[1]
    : undefined
  if (
    sectionVersion !== undefined &&
    hasChangelogVersionSection(existing, sectionVersion)
  ) {
    return existing
  }
  const lines = existing.split(/\r?\n/)
  const firstHeading = headingLines(existing, 2)[0] ?? -1
  if (firstHeading === -1) {
    return `${existing.replace(/\s*$/, '')}\n\n${section}\n`
  }
  const before = lines.slice(0, firstHeading).join('\n').replace(/\s*$/, '')
  const after = lines.slice(firstHeading).join('\n')
  return `${before}\n\n${section}\n\n${after}`
}
