/**
 * @file Hot-path benchmark for `PackageURL.fromString`. Models a lockfile scan:
 *   a few thousand DISTINCT purl strings parsed once each, which is the
 *   flyweight cache's worst case (near-100% miss). A second pass re-parses a
 *   small set repeatedly to keep the cache-hit path honest.
 *   Benchmarks the SHIPPED bundle (`dist/index.js`), so run `pnpm run build`
 *   first. Each pass is repeated and the MINIMUM is reported: on a loaded
 *   machine the mean tracks the competing load, the minimum tracks the code.
 *   CPU time is the headline number for the same reason — it excludes time the
 *   scheduler gave to other processes. GC count and pause total are the
 *   allocation-pressure proxy.
 *   Usage: `node scripts/repo/bench-from-string.mts [--corpus N] [--runs N]
 *   [--reps N]`
 */

import { existsSync } from 'node:fs'
import { performance, PerformanceObserver } from 'node:perf_hooks'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

type BenchResult = {
  cpuMs: number
  gcCount: number
  gcPauseMs: number
  label: string
  opsPerSec: number
  parsed: number
  wallMs: number
}

const ECOSYSTEMS = [
  'npm',
  'maven',
  'pypi',
  'golang',
  'cargo',
  'gem',
  'nuget',
  'composer',
] as const

const NAME_STEMS = [
  'core',
  'utils',
  'parser',
  'runtime',
  'client',
  'server',
  'codec',
  'stream',
  'logger',
  'cache',
  'router',
  'schema',
]

/**
 * Build a deterministic corpus of distinct purl strings shaped like the mix a
 * real monorepo lockfile produces: mostly plain entries, a slice of scoped and
 * multi-segment namespaces, and a tail carrying qualifiers and subpaths.
 */
export function buildPurlCorpus(size: number): string[] {
  const corpus: string[] = []
  for (let i = 0; i < size; i += 1) {
    const eco = ECOSYSTEMS[i % ECOSYSTEMS.length]!
    const stem = NAME_STEMS[i % NAME_STEMS.length]!
    const version = `${1 + (i % 19)}.${i % 37}.${i % 53}`
    if (eco === 'npm' && i % 3 === 0) {
      corpus.push(`pkg:npm/%40scope${i % 400}/${stem}-${i}@${version}`)
    } else if (eco === 'maven') {
      corpus.push(`pkg:maven/com.example.grp${i % 300}/${stem}-${i}@${version}`)
    } else if (eco === 'golang') {
      corpus.push(
        `pkg:golang/github.com/owner${i % 250}/${stem}-${i}@v${version}`,
      )
    } else if (i % 11 === 0) {
      corpus.push(
        `pkg:${eco}/${stem}-${i}@${version}?arch=x86_64&os=linux#lib/${stem}`,
      )
    } else if (i % 7 === 0) {
      corpus.push(`pkg:${eco}/${stem}-${i}@${version}?extension=tgz`)
    } else {
      corpus.push(`pkg:${eco}/${stem}-${i}@${version}`)
    }
  }
  return corpus
}

/**
 * Run the timed loop once and report CPU and wall time for it.
 */
function timeOnePass(
  strings: readonly string[],
  runs: number,
  parse: (_purlStr: string) => unknown,
): { cpuMs: number; sink: number; wallMs: number } {
  const cpuStart = process.cpuUsage()
  const wallStart = performance.now()
  let sink = 0
  for (let run = 0; run < runs; run += 1) {
    for (let i = 0, { length } = strings; i < length; i += 1) {
      const purl = parse(strings[i]!) as { name?: string | undefined }
      sink += purl.name === undefined ? 0 : 1
    }
  }
  const wallMs = performance.now() - wallStart
  const cpu = process.cpuUsage(cpuStart)
  return { cpuMs: (cpu.user + cpu.system) / 1000, sink, wallMs }
}

/**
 * Repeat a pass `reps` times and report the fastest one. GC entries arrive on a
 * later turn of the event loop, so the counters are read after yielding.
 */
export async function measurePass(
  label: string,
  strings: readonly string[],
  runs: number,
  reps: number,
  parse: (_purlStr: string) => unknown,
): Promise<BenchResult> {
  let gcCount = 0
  let gcPauseMs = 0
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      gcCount += 1
      gcPauseMs += entry.duration
    }
  })
  observer.observe({ entryTypes: ['gc'] })

  const parsed = strings.length * runs
  let bestCpuMs = Infinity
  let bestWallMs = Infinity
  for (let rep = 0; rep < reps; rep += 1) {
    const { cpuMs, sink, wallMs } = timeOnePass(strings, runs, parse)
    if (sink !== parsed) {
      throw new Error(
        `Benchmark sink mismatch. In ${label}. Saw ${sink} named purls, wanted ${parsed}. Fix: check the corpus for entries that parse without a name.`,
      )
    }
    if (cpuMs < bestCpuMs) {
      bestCpuMs = cpuMs
    }
    if (wallMs < bestWallMs) {
      bestWallMs = wallMs
    }
  }
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0)
  })
  observer.disconnect()

  return {
    cpuMs: bestCpuMs,
    gcCount,
    gcPauseMs,
    label,
    opsPerSec: (parsed / bestCpuMs) * 1000,
    parsed,
    wallMs: bestWallMs,
  }
}

/**
 * Render one result row.
 */
export function formatBenchResult(result: BenchResult): string {
  const { cpuMs, gcCount, gcPauseMs, label, opsPerSec, parsed, wallMs } = result
  return [
    label.padEnd(16),
    `${cpuMs.toFixed(1).padStart(8)} ms cpu`,
    `${wallMs.toFixed(1).padStart(8)} ms wall`,
    `${Math.round(opsPerSec).toLocaleString('en-US').padStart(11)} ops/s`,
    `${String(parsed).padStart(8)} parsed`,
    `${String(gcCount).padStart(4)} gc`,
    `${gcPauseMs.toFixed(1).padStart(7)} ms gc`,
  ].join('  ')
}

/**
 * Run the distinct-string and repeated-string passes and print both.
 */
export async function runFromStringBenchmark(): Promise<void> {
  const { values } = parseArgs({
    options: {
      corpus: { type: 'string', default: '5000' },
      entry: { type: 'string', default: 'dist/index.js' },
      reps: { type: 'string', default: '7' },
      runs: { type: 'string', default: '10' },
    },
    strict: true,
  })
  const corpusSize = Number(values.corpus)
  const entry = values.entry!
  const reps = Number(values.reps)
  const runs = Number(values.runs)

  const entryPath = path.resolve(rootPath, entry)
  if (!existsSync(entryPath)) {
    throw new Error(
      `Benchmark entry is missing. In ${entryPath}. Saw no file there, wanted a built bundle. Fix: run \`pnpm run build\`, or pass an existing bundle with --entry.`,
    )
  }
  const mod = (await import(entryPath)) as {
    PackageURL: { fromString: (_purlStr: string) => unknown }
  }
  const { PackageURL } = mod
  const parse = (purlStr: string) => PackageURL.fromString(purlStr)

  const corpus = buildPurlCorpus(corpusSize)
  const repeated = corpus.slice(0, 64)

  // Warm the JIT without polluting the reported numbers.
  await measurePass('warmup', corpus.slice(0, 500), 4, 2, parse)
  await measurePass('warmup', repeated, 40, 2, parse)

  const distinct = await measurePass(
    'distinct (miss)',
    corpus,
    runs,
    reps,
    parse,
  )
  const hits = await measurePass(
    'repeated (hit)',
    repeated,
    runs * 250,
    reps,
    parse,
  )

  logger.log(
    `corpus=${corpusSize} runs=${runs} reps=${reps} entry=${entry} (best of ${reps})`,
  )
  logger.log(formatBenchResult(distinct))
  logger.log(formatBenchResult(hits))
}

runFromStringBenchmark().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
