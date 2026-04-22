/**
 * @fileoverview Socket.dev malware audit for the walkthrough pilot.
 *
 * Two entry points: `auditValDeps()` runs before the Val Town deploy
 * (scans the transitive closure of `npm:` specifiers imported by our
 * val files), and `auditCdnScripts()` runs after HTML generation
 * (scans the third-party scripts meander emits `<script src=>` tags for
 * — marked, highlight.js). Both fail-closed: a malware alert aborts
 * the deploy / generate step.
 *
 * Closure resolution is done locally via `pacote.manifest()` so we
 * don't depend on Val Town exposing its own deno.lock via API (it
 * doesn't). Same npm registry + semver resolution Deno uses at
 * runtime, so the local pacote tree matches what the val will load.
 *
 * API uses the built-in `SOCKET_PUBLIC_API_TOKEN` — no user secret
 * required, same pattern as socket-sdk-js's `check-new-deps` hook.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { SOCKET_PUBLIC_API_TOKEN } from '@socketsecurity/lib/constants/socket'
import { SocketSdk } from '@socketsecurity/sdk'
import type { MalwareCheckPackage } from '@socketsecurity/sdk'
import pacote from 'pacote'
import semver from 'semver'

// Matches `npm:<scope?>/<name>@<version>(/subpath)?` — the Deno npm
// specifier shape. `version` may be a semver range (we normalize it
// to the resolved exact version via pacote). Scope is optional but
// if present starts with `@`.
const NPM_SPECIFIER_RE =
  /npm:(?<spec>(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*@[a-z0-9.+~-]+)(?:\/|['"])/gi

// Matches `<script src="https://unpkg.com/<scope?>/<name>@<version>/...`.
// unpkg is the convention meander uses; extend the regex if we ever
// add a CDN.
const UNPKG_SCRIPT_RE =
  /<script\s+src="https:\/\/unpkg\.com\/(?<spec>(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*@[a-z0-9.+~-]+)\//gi

const API_TIMEOUT_MS = 10_000
// Socket API caps batch at 1024; we stay well under.
const MAX_BATCH_SIZE = 500

type NpmDep = {
  name: string
  version: string
  source: 'direct' | 'transitive' | 'cdn'
}

const sdk = new SocketSdk(SOCKET_PUBLIC_API_TOKEN, { timeout: API_TIMEOUT_MS })

// --- specifier extraction ---

/**
 * Parse `npm:` specifiers out of every `.ts` file in `dir`. Deduped
 * by `name@version` string. Only direct deps — transitives come from
 * the pacote walk.
 */
function extractNpmDepsFromDir(dir: string): NpmDep[] {
  const seen = new Map<string, NpmDep>()
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.ts')) {
      continue
    }
    const source = readFileSync(path.join(dir, entry), 'utf8')
    for (const m of source.matchAll(NPM_SPECIFIER_RE)) {
      const spec = m.groups!['spec']!
      const atIndex = spec.lastIndexOf('@')
      const name = spec.slice(0, atIndex)
      const version = spec.slice(atIndex + 1)
      const key = `${name}@${version}`
      if (!seen.has(key)) {
        seen.set(key, { name, version, source: 'direct' })
      }
    }
  }
  return [...seen.values()]
}

/**
 * Extract unpkg script deps from generated HTML files.
 */
function extractCdnDepsFromDir(dir: string): NpmDep[] {
  const seen = new Map<string, NpmDep>()
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.html')) {
      continue
    }
    const source = readFileSync(path.join(dir, entry), 'utf8')
    for (const m of source.matchAll(UNPKG_SCRIPT_RE)) {
      const spec = m.groups!['spec']!
      const atIndex = spec.lastIndexOf('@')
      const name = spec.slice(0, atIndex)
      const version = spec.slice(atIndex + 1)
      const key = `${name}@${version}`
      if (!seen.has(key)) {
        seen.set(key, { name, version, source: 'cdn' })
      }
    }
  }
  return [...seen.values()]
}

// --- transitive closure via pacote ---

/**
 * Resolve each direct dep's transitive closure via pacote and return
 * a flat deduped list. Versions are resolved to exact (pacote returns
 * the manifest for the resolved version even when the spec is a range).
 *
 * We don't attempt to reach devDependencies — only runtime deps are
 * what Deno will actually fetch. Peer deps are optional and usually
 * satisfied by the consumer; skip unless they land in the graph by
 * being declared as regular dependencies elsewhere.
 */
async function walkTransitiveClosure(
  directs: readonly NpmDep[],
): Promise<NpmDep[]> {
  const closure = new Map<string, NpmDep>()
  const queue: Array<{ spec: string; source: NpmDep['source'] }> = directs.map(
    d => ({ spec: `${d.name}@${d.version}`, source: 'direct' }),
  )

  while (queue.length > 0) {
    const { spec, source } = queue.shift()!
    // Skip if we've already processed this resolved pair.
    // Two different ranges may resolve to the same exact version;
    // dedupe on the post-resolution pair.
    let manifest
    try {
      manifest = await pacote.manifest(spec, { fullMetadata: false })
    } catch {
      // Network error, package not found, etc. Skip — the deploy will
      // fail on the API call anyway if Socket can't score it.
      continue
    }
    const key = `${manifest.name}@${manifest.version}`
    if (closure.has(key)) {
      continue
    }
    closure.set(key, {
      name: manifest.name,
      version: manifest.version,
      source,
    })
    // Enqueue declared runtime deps as transitives.
    const deps = (manifest.dependencies ?? {}) as Record<string, string>
    for (const [depName, depRange] of Object.entries(deps)) {
      // pacote expects `<name>@<spec>`; `depRange` may be `^1.0.0`,
      // `~2.3`, a tag like `latest`, or a git URL. pacote handles all.
      if (!semver.validRange(depRange) && !depRange.includes(':')) {
        // Tag or odd spec — let pacote attempt resolution anyway.
      }
      queue.push({ spec: `${depName}@${depRange}`, source: 'transitive' })
    }
  }
  return [...closure.values()]
}

// --- Socket.dev malware check ---

type AuditFinding = {
  dep: NpmDep
  alerts: Array<{ type: string; severity: string | undefined }>
}

async function checkMalwareBatched(
  deps: readonly NpmDep[],
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = []
  for (let i = 0; i < deps.length; i += MAX_BATCH_SIZE) {
    const batch = deps.slice(i, i + MAX_BATCH_SIZE)
    const components = batch.map(d => ({
      purl: `pkg:npm/${d.name}@${d.version}`,
    }))
    const result = await sdk.checkMalware(components)
    if (!result.success) {
      throw new Error(
        `Socket API returned status ${result.status} — cannot audit, failing closed.`,
      )
    }
    // Index returned packages by name@version for lookup.
    const byKey = new Map<string, MalwareCheckPackage>()
    for (const pkg of result.data) {
      const key = `${pkg.name ?? ''}@${pkg.version ?? ''}`
      byKey.set(key, pkg)
    }
    for (const dep of batch) {
      const pkg = byKey.get(`${dep.name}@${dep.version}`)
      if (!pkg?.alerts?.length) {
        continue
      }
      // Fail on malware type OR critical severity of any kind.
      const blocking = pkg.alerts.filter(
        a => a.type === 'malware' || a.severity === 'critical',
      )
      if (blocking.length > 0) {
        findings.push({
          dep,
          alerts: blocking.map(a => ({ type: a.type, severity: a.severity })),
        })
      }
    }
  }
  return findings
}

// --- public entry points ---

/**
 * Audit the val's transitive npm dep closure. Throws on finding,
 * caller aborts the deploy.
 */
export async function auditValDeps(repoRoot: string): Promise<void> {
  const valDir = path.join(repoRoot, 'val')
  const directs = extractNpmDepsFromDir(valDir)
  if (directs.length === 0) {
    console.log('[audit-deps] no npm specifiers found in val/')
    return
  }
  console.log(
    `[audit-deps] val direct deps: ${directs.map(d => `${d.name}@${d.version}`).join(', ')}`,
  )
  const closure = await walkTransitiveClosure(directs)
  console.log(
    `[audit-deps] resolved closure: ${closure.length} package${closure.length === 1 ? '' : 's'} (${closure.filter(c => c.source === 'direct').length} direct, ${closure.filter(c => c.source === 'transitive').length} transitive)`,
  )
  const findings = await checkMalwareBatched(closure)
  reportAndThrow(findings, 'val deployment')
}

/**
 * Audit the CDN scripts the generated walkthrough HTML loads via
 * `<script src=https://unpkg.com/...>`. No transitive walk — CDN
 * bundles are preflight-built, their deps don't ship separately.
 */
export async function auditCdnScripts(walkthroughDir: string): Promise<void> {
  const cdnDeps = extractCdnDepsFromDir(walkthroughDir)
  if (cdnDeps.length === 0) {
    console.log('[audit-deps] no unpkg CDN scripts in walkthrough HTML')
    return
  }
  console.log(
    `[audit-deps] CDN scripts: ${cdnDeps.map(d => `${d.name}@${d.version}`).join(', ')}`,
  )
  const findings = await checkMalwareBatched(cdnDeps)
  reportAndThrow(findings, 'walkthrough generation')
}

function reportAndThrow(findings: AuditFinding[], scope: string): void {
  if (findings.length === 0) {
    console.log(`[audit-deps] ${scope}: clean`)
    return
  }
  console.error(`[audit-deps] ${scope}: BLOCKED by Socket.dev`)
  for (const f of findings) {
    const alertsStr = f.alerts
      .map(a => `${a.type} (${a.severity ?? 'unspecified'})`)
      .join(', ')
    console.error(
      `  ${f.dep.name}@${f.dep.version} [${f.dep.source}] — ${alertsStr}`,
    )
  }
  throw new Error(
    `${findings.length} package${findings.length === 1 ? '' : 's'} flagged — aborting.`,
  )
}
