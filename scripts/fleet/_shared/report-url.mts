/**
 * @file The address a generated fleet report is reachable at. Its own module
 *   because two callers need it and neither should own it: `serve-reports.mts`
 *   binds the port and registers the route, and the statusline wraps a
 *   hyperlink around the meter pointing at the page. One definition means the
 *   link can never aim somewhere nothing is listening. WHY NOT `file://`. A
 *   file URL carries the author's home directory, so it is useless the moment
 *   it is pasted anywhere another machine reads it, and it puts every report in
 *   one opaque origin, so a page's `fetch` of the data it wrote beside itself
 *   is a cross-origin read from `null` and is blocked. The portless host fixes
 *   both: one stable name, one real origin per report directory.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { fleetReportsRoot } from './spend-report-path.mts'

/**
 * The portless route name. One name for every fleet report, so a URL a reader
 * has seen once keeps working when a new generator is added.
 */
export const REPORTS_ROUTE = 'fleet-reports'

/**
 * The port the local server binds. Fixed rather than ephemeral: portless maps a
 * name to a port, so a moving port means re-registering the route every run.
 */
export const REPORTS_PORT = 4310

/**
 * The stable URL a report is reachable at.
 */
export function reportsUrl(relativePath = ''): string {
  const suffix = relativePath.replace(/^\/+/, '')
  return `https://${REPORTS_ROUTE}.localhost/${suffix}`
}

/**
 * The href for a report file on disk.
 *
 * A path inside the reports directory becomes a portless URL; anything else
 * falls back to `file://`. The fallback is what keeps a caller honest about
 * reports written somewhere else rather than silently pointing at a route that
 * does not serve them.
 */
export function reportHref(
  target: string,
  reportsDir: string = fleetReportsRoot(),
): string {
  const root = normalizePath(path.resolve(reportsDir))
  const resolved = normalizePath(path.resolve(target))
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    return pathToFileURL(target).href
  }
  return reportsUrl(resolved.slice(root.length))
}
