/**
 * @file Where a rendered fleet report lives, and how a terminal links to it.
 *   Its own module because two callers need the location and neither should own
 *   it: the report writer creates the file, and the statusline wraps a
 *   hyperlink around the meter pointing at it. One definition means the link
 *   can never aim at a path nothing writes. The layout is one directory per
 *   producing script, named after it, holding `index.html` plus an `assets/`
 *   directory for anything the page cannot inline. So `spend-report.mts` writes
 *   `reports/spend-report/index.html`, and the directory name says which script
 *   to re-run to refresh it. EVERY report takes this shape, including one that
 *   inlines everything and ships no assets today. A second flat shape would
 *   make every consumer look for both, and a report that later grew an asset
 *   would move, breaking whatever pointed at the old path. Generated and
 *   untracked, unlike the hand-written Markdown in `.claude/reports/`.
 */

import path from 'node:path'

import { FLEET_REPORTS_DIR } from '../paths.mts'
import { reportHref } from './report-url.mts'

export const SPEND_REPORT_SCRIPT = 'spend-report'

/**
 * The entry document every report writes. Fixed name so a reader (and a browser
 * opening the directory) finds the report without knowing the script's name
 * twice.
 */
export const REPORT_INDEX_NAME = 'index.html'

/**
 * Where a report's companion files go. Everything a report cannot inline lives
 * under here, so the directory listing separates the page from its parts.
 */
export const REPORT_ASSETS_DIR_NAME = 'assets'

/**
 * The reports tree root every per-report path is built under.
 *
 * The layout helper owns this location so a server that serves the whole tree
 * and a URL mapper that tests containment ask it instead of naming the constant
 * directly. One definition keeps the writer, the server, and the linker from
 * disagreeing about where the reports directory lives.
 */
export function fleetReportsRoot(): string {
  return FLEET_REPORTS_DIR
}

/**
 * A report's own directory, named after the script that writes it.
 *
 * `scriptName` is the producing script's base name without an extension, so the
 * directory says which `.mts` file to re-run to refresh it.
 */
export function fleetReportDir(
  scriptName: string,
  reportsDir: string = FLEET_REPORTS_DIR,
): string {
  return path.join(reportsDir, scriptName)
}

/**
 * A report's entry document.
 *
 * Every report gets a directory, including one that inlines everything and
 * ships no assets today. Two shapes would mean every consumer had to look for
 * both, and a report that later grows an asset would move, breaking whatever
 * pointed at the old path. One shape costs an empty-ish directory and buys a
 * stable location.
 */
export function fleetReportPath(
  scriptName: string,
  reportsDir: string = FLEET_REPORTS_DIR,
): string {
  return path.join(fleetReportDir(scriptName, reportsDir), REPORT_INDEX_NAME)
}

/**
 * A report's assets directory.
 */
export function fleetReportAssetsDir(
  scriptName: string,
  reportsDir: string = FLEET_REPORTS_DIR,
): string {
  return path.join(
    fleetReportDir(scriptName, reportsDir),
    REPORT_ASSETS_DIR_NAME,
  )
}

/**
 * One asset inside a report's assets directory.
 *
 * Rejects a name carrying a separator or a `..` segment. Asset names are
 * written by the producing script rather than typed by a user, so this is not
 * defending against an attacker; it is making a path that escapes the report
 * directory fail at the call rather than silently writing outside it.
 */
export function fleetReportAssetPath(
  scriptName: string,
  assetName: string,
  reportsDir: string = FLEET_REPORTS_DIR,
): string {
  if (
    assetName.length === 0 ||
    assetName.includes('/') ||
    assetName.includes('\\') ||
    assetName.split(path.sep).includes('..') ||
    assetName === '..'
  ) {
    throw new Error(
      `Invalid report asset name "${assetName}" for ${scriptName}. Where: fleetReportAssetPath. Saw a name carrying a path separator or a parent segment; wanted a single file name. Fix: pass a bare file name and let this helper place it under ${REPORT_ASSETS_DIR_NAME}/.`,
    )
  }
  return path.join(fleetReportAssetsDir(scriptName, reportsDir), assetName)
}

/**
 * The spend report's entry document.
 */
export function spendReportPath(reportsDir?: string | undefined): string {
  return reportsDir === undefined
    ? fleetReportPath(SPEND_REPORT_SCRIPT)
    : fleetReportPath(SPEND_REPORT_SCRIPT, reportsDir)
}

/**
 * Wrap text in an OSC 8 hyperlink.
 *
 * This is what makes the meter clickable: the terminal turns the escape into a
 * link, and the target is the report's portless URL, so the page opens on a
 * real origin and can fetch the detail it wrote beside itself. A report written
 * outside the reports directory falls back to `file://`.
 *
 * A terminal that does not understand OSC 8 renders the text unchanged rather
 * than leaking escapes, because the payload sits inside the ST-terminated
 * sequence rather than in the visible run.
 */
export function osc8Link(target: string, label: string): string {
  return osc8Href(reportHref(target), label)
}

/**
 * Wrap text in an OSC 8 hyperlink pointing at a URL that is already resolved.
 *
 * The twin of {@link osc8Link}, which resolves a filesystem path first. A
 * provider gauge links to that seat's own dashboard, which is a real URL rather
 * than anything on disk, so it needs the form that skips path resolution.
 */
export function osc8Href(url: string, label: string): string {
  // OSC 8 is: ESC ] 8 ; ; URI BEL  text  ESC ] 8 ; ; BEL. Written with explicit
  // escapes so the bytes are reviewable instead of invisible control characters
  // sitting in the source.
  const open = '\u001B]8;;'
  const bel = '\u0007'
  return `${open}${url}${bel}${label}${open}${bel}`
}
