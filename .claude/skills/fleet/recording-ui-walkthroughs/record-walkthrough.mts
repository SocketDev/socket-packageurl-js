#!/usr/bin/env node
/*
 * @file Record a browser walkthrough as a video, with a drawn pointer and a
 *   ripple on every click, so a guide can SHOW a flow instead of only
 *   describing it.
 *
 *     node .claude/skills/fleet/recording-ui-walkthroughs/record-walkthrough.mts \
 *       <profile.json> [--out walkthrough.mp4] [--timeline timeline.ts] [--keep-frames]
 *
 *   A walkthrough is data: the JSON profile names a start URL, an optional
 *   dev-only login, a viewport, an output width, and ordered steps. One
 *   implementation therefore covers a flow of ours and a third-party flow such
 *   as creating an npm token, which differs only by profile — film a mockup for
 *   that (see npm-mockup.mts), never a real signed-in account.
 *
 *   Output is H.264 unless the --out name ends in .gif. Prefer the video: it can
 *   be paused, seeked, and asked what time it is, so the UI showing it can hold
 *   on a step and highlight the step actually playing.
 *
 *   ffmpeg must be on PATH (brew install ffmpeg).
 *
 *   Exit codes: 0 — recording written, path printed; 1 — recording failed.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import type { Page } from 'playwright-core'

import { openNpmBrowserSession } from '../../../../scripts/fleet/registry-infra/npm/browser-session.mts'
import { isMainModule } from '../../../../scripts/fleet/_shared/is-main-module.mts'
import { runMain } from '../../../../scripts/fleet/_shared/run-main.mts'
import type { ScriptMeta } from '../../../../scripts/fleet/_shared/run-main.mts'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

/**
 * Development-only chrome that must never reach a recording: a framework's dev
 * badge is scaffolding, not product. CSS rather than removing nodes, because
 * dev tools re-mount their host element on navigation and on hot reload, so a
 * one-time remove() loses the race.
 */
const DEV_OVERLAY_HIDE_CSS = `${[
  'nextjs-portal',
  '#devtools-indicator',
  '.nextjs-toast',
  '[data-nextjs-toast]',
  '[data-nextjs-dev-tools-button]',
  '.tsqd-parent-container',
].join(',\n')} { display: none !important; }`

interface WalkthroughStep {
  check?: string | undefined
  click?: string | undefined
  goto?: string | undefined
  /**
   * Written step this and the following frames illustrate.
   */
  guideStep?: string | undefined
  hold?: number | undefined
  point?: string | undefined
  scrollTo?: string | undefined
  setText?: string | undefined
  text?: string | undefined
  type?: string | undefined
}

interface WalkthroughProfile {
  /**
   * Frames per second of the finished GIF. 10 reads smoothly and stays small.
   */
  fps?: number | undefined
  /**
   * Dev-only magic-link login, skipped when absent (third-party sites).
   */
  login?: { email: string; loginUrl: string } | undefined
  /**
   * Width of the finished GIF. Defaults to the viewport's, which is heavy.
   */
  outputWidth?: number | undefined
  startUrl: string
  steps: WalkthroughStep[]
  viewport?: { height: number; width: number } | undefined
}

/**
 * Frames spent easing the pointer between two targets.
 */
const MOVE_FRAMES = 10
/**
 * How far the view may travel in one frame. A scroll is spread over as many
 * frames as it takes to respect this, so a long scroll takes longer rather than
 * moving further per frame — the distance is what makes a scroll read as a cut,
 * not how long it lasts.
 */
const SCROLL_PX_PER_FRAME = 30
/**
 * Bounds on that: enough frames to be a movement, few enough to stay light.
 */
const MIN_SCROLL_FRAMES = 8
const MAX_SCROLL_FRAMES = 32
/**
 * How long one click ripple takes. The UI that shows a recording ripples the
 * step it is on at the same duration, so the two read as one language; keep
 * them in step (workspaces/next-app/.../NpmStagingTokenSettings.tsx).
 */
const RIPPLE_MS = 1200
/**
 * How far a ripple grows before it disappears.
 */
const RIPPLE_MAX_SCALE = 4.4

/**
 * Ripple stages for one frame each, sized to RIPPLE_MS at this frame rate.
 */
function rippleStages(fps: number): ReadonlyArray<readonly [number, number]> {
  const frames = Math.max(2, Math.round((fps * RIPPLE_MS) / 1000))
  return Array.from({ length: frames }, (_unused, i) => {
    const progress = i / (frames - 1)
    return [
      1 + (RIPPLE_MAX_SCALE - 1) * progress,
      Math.max(0, 1 - progress),
    ] as const
  })
}

/**
 * Injected into the page: a pointer that can be positioned, and a ripple
 * whose scale is driven per frame rather than by a CSS animation, so each
 * captured frame shows a deterministic stage of the effect.
 */
const OVERLAY_SOURCE = `(() => {
  const style = document.createElement('style')
  style.textContent = [
    '#ui-walkthrough-cursor { position: fixed; z-index: 2147483647; width: 22px;',
    '  height: 22px; margin: -2px 0 0 -2px; pointer-events: none; }',
    '#ui-walkthrough-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }',
    '.ui-walkthrough-ripple { position: fixed; z-index: 2147483646; width: 14px;',
    '  height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; pointer-events: none;',
    '  background: rgba(135,53,217,.30); border: 2px solid rgba(135,53,217,.95); }',
  ].join('') + ${JSON.stringify(DEV_OVERLAY_HIDE_CSS)}
  document.head.appendChild(style)
  const cursor = document.createElement('div')
  cursor.id = 'ui-walkthrough-cursor'
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 2l14 10-6 1 3 7-3 1-3-7-5 4z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  document.body.appendChild(cursor)
  window.__uiWalkthrough = {
    at: { x: 0, y: 0 },
    move(x, y) {
      this.at = { x, y }
      cursor.style.left = x + 'px'
      cursor.style.top = y + 'px'
    },
    ripple(x, y, scale, opacity) {
      let node = document.querySelector('.ui-walkthrough-ripple')
      if (!node) {
        node = document.createElement('div')
        node.className = 'ui-walkthrough-ripple'
        document.body.appendChild(node)
      }
      node.style.left = x + 'px'
      node.style.top = y + 'px'
      node.style.transform = 'scale(' + scale + ')'
      node.style.opacity = String(opacity)
    },
    clearRipple() {
      const node = document.querySelector('.ui-walkthrough-ripple')
      if (node) {
        node.remove()
      }
    },
  }
})()`

interface Point {
  x: number
  y: number
}

class Recorder {
  // Explicit fields rather than constructor parameter properties: Node's
  // strip-only TypeScript support rejects those, and this runs on plain node.
  count = 0
  page: Page
  framesDir: string

  constructor(page: Page, framesDir: string) {
    this.page = page
    this.framesDir = framesDir
  }

  get frames(): number {
    return this.count
  }

  async shoot(times = 1): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      const name = `f${String(this.count).padStart(4, '0')}.png`
      await this.page.screenshot({ path: path.join(this.framesDir, name) })
      this.count += 1
    }
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

/**
 * Scrolls until the target is comfortably in view, over enough frames to read
 * as a glide. Playwright's scrollIntoViewIfNeeded lands in one frame, which
 * cuts mid-recording and loses the reader's place; and CSS smooth scrolling is
 * no help because frames are captured on our own schedule rather than the
 * page's. So the scroll is stepped here, one screenshot per position, with the
 * step size bounded rather than the duration.
 */
async function glideTo(
  page: Page,
  recorder: Recorder,
  selector: string,
): Promise<void> {
  const plan = await page.evaluate(sel => {
    const node = document.querySelector(sel)
    if (!node) {
      throw new Error(`Walkthrough scroll target not found: ${sel}`)
    }
    const box = node.getBoundingClientRect()
    const from = window.scrollY
    const centered = from + box.top - (window.innerHeight - box.height) / 2
    const furthest = document.documentElement.scrollHeight - window.innerHeight
    return {
      from,
      to: Math.max(0, Math.min(centered, Math.max(0, furthest))),
    }
  }, selector)
  const distance = plan.to - plan.from
  // A few pixels is not a scroll; moving anyway only adds idle frames.
  if (Math.abs(distance) < 8) {
    return
  }
  const frames = Math.min(
    MAX_SCROLL_FRAMES,
    Math.max(
      MIN_SCROLL_FRAMES,
      Math.round(Math.abs(distance) / SCROLL_PX_PER_FRAME),
    ),
  )
  for (let i = 1; i <= frames; i += 1) {
    const eased = easeInOut(i / frames)
    await page.evaluate(
      y => {
        window.scrollTo(0, y)
      },
      Math.round(plan.from + distance * eased),
    )
    await recorder.shoot()
  }
}

async function pointerTo(
  page: Page,
  recorder: Recorder,
  selector: string,
): Promise<Point> {
  const locator = page.locator(selector).first()
  await glideTo(page, recorder, selector)
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error(`Walkthrough target has no box: ${selector}`)
  }
  // Land inside the element but off-centre, which looks aimed rather than
  // mechanically snapped to the middle.
  const target = {
    x: Math.round(box.x + Math.min(40, box.width / 2)),
    y: Math.round(box.y + box.height / 2),
  }
  const from = await page.evaluate(
    () =>
      (window as unknown as { __uiWalkthrough: { at: Point } }).__uiWalkthrough
        .at,
  )
  const start =
    from.x === 0 && from.y === 0
      ? { x: target.x + 420, y: target.y + 180 }
      : from
  for (let i = 1; i <= MOVE_FRAMES; i += 1) {
    const eased = easeInOut(i / MOVE_FRAMES)
    await page.evaluate(
      p =>
        (
          window as unknown as {
            __uiWalkthrough: { move: (x: number, y: number) => void }
          }
        ).__uiWalkthrough.move(p.x, p.y),
      {
        x: Math.round(start.x + (target.x - start.x) * eased),
        y: Math.round(start.y + (target.y - start.y) * eased),
      },
    )
    await recorder.shoot()
  }
  return target
}

async function rippleAt(
  page: Page,
  recorder: Recorder,
  at: Point,
  stages: ReadonlyArray<readonly [number, number]>,
): Promise<void> {
  for (const [scale, opacity] of stages) {
    await page.evaluate(
      a =>
        (
          window as unknown as {
            __uiWalkthrough: {
              ripple: (
                x: number,
                y: number,
                scale: number,
                opacity: number,
              ) => void
            }
          }
        ).__uiWalkthrough.ripple(a.x, a.y, a.scale, a.opacity),
      { ...at, opacity, scale },
    )
    await recorder.shoot()
  }
  await page.evaluate(() =>
    (
      window as unknown as { __uiWalkthrough: { clearRipple: () => void } }
    ).__uiWalkthrough.clearRipple(),
  )
}

async function runStep(
  page: Page,
  recorder: Recorder,
  step: WalkthroughStep,
  stages: ReadonlyArray<readonly [number, number]>,
): Promise<void> {
  if (step.goto) {
    await page.goto(step.goto)
    await page.evaluate(OVERLAY_SOURCE)
    await recorder.shoot(4)
    return
  }
  if (step.scrollTo) {
    await glideTo(page, recorder, step.scrollTo)
    await recorder.shoot(3)
    return
  }
  if (step.hold) {
    await recorder.shoot(step.hold)
    return
  }
  if (step.click) {
    // pointerTo glides first, which leaves Playwright's own actionability
    // scroll with nothing to do — otherwise it would snap the view on click.
    const at = await pointerTo(page, recorder, step.click)
    await rippleAt(page, recorder, at, stages)
    await page.locator(step.click).first().click()
    // Sample whatever the click animates rather than assuming a duration.
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(60)
      await recorder.shoot()
    }
    return
  }
  if (step.point) {
    // A step whose instruction is to leave a control alone still needs
    // somewhere for the reader to look.
    await pointerTo(page, recorder, step.point)
    await recorder.shoot(2)
    return
  }
  if (step.setText) {
    await page.evaluate(
      a => {
        const node = document.querySelector(a.selector)
        if (!node) {
          throw new Error(`setText target not found: ${a.selector}`)
        }
        node.textContent = a.text
      },
      { selector: step.setText, text: step.text ?? '' },
    )
    await recorder.shoot()
    return
  }
  if (step.check) {
    const at = await pointerTo(page, recorder, step.check)
    await rippleAt(page, recorder, at, stages)
    await page.locator(step.check).first().check()
    await recorder.shoot(3)
    return
  }
  if (step.type) {
    const at = await pointerTo(page, recorder, step.type)
    await rippleAt(page, recorder, at, stages)
    await page
      .locator(step.type)
      .first()
      .fill(step.text ?? '')
    await recorder.shoot(3)
    return
  }
  throw new Error(`Unrecognized walkthrough step: ${JSON.stringify(step)}`)
}

interface GuideSpan {
  endFrame: number
  key: string
  startFrame: number
}

/**
 * CamelCases a file name into an exported identifier, ending in Timeline
 * without repeating it when the file is already named for one.
 */
function timelineExportName(timelinePath: string): string {
  const stem = path.basename(timelinePath).replace(/\..*$/, '')
  const camel = stem.replace(/[-_]([a-z0-9])/g, (_all, c: string) =>
    c.toUpperCase(),
  )
  return camel.endsWith('Timeline') ? camel : `${camel}Timeline`
}

/**
 * Writes the guide-step spans as a TypeScript module beside the UI that
 * consumes them. A module rather than JSON because the app does not enable
 * `resolveJsonModule`, and generating it here is what keeps the timings and the
 * GIF from describing different recordings.
 */
function writeTimelineModule(config: {
  fps: number
  profilePath: string
  spans: readonly GuideSpan[]
  targetPath: string
  totalFrames: number
}): void {
  const cfg = { __proto__: null, ...config } as typeof config
  const msPerFrame = 1000 / cfg.fps
  const steps = cfg.spans
    .map(span => {
      const startMs = Math.round(span.startFrame * msPerFrame)
      const endMs = Math.round(span.endFrame * msPerFrame)
      return `    { endMs: ${endMs}, key: '${span.key}', startMs: ${startMs} },`
    })
    .join('\n')
  const source = `/**
 * Frame timings of ${path.basename(cfg.profilePath)}, one span per written step.
 *
 * Generated by tools/record-ui-walkthrough.mts. Do not edit: re-record the
 * walkthrough and the timings follow the new GIF.
 */

import type { WalkthroughTimeline } from '@/lib/ui-walkthrough/timeline'

export const ${timelineExportName(cfg.targetPath)}: WalkthroughTimeline = {
  steps: [
${steps}
  ],
  totalMs: ${Math.round(cfg.totalFrames * msPerFrame)},
}
`
  writeFileSync(cfg.targetPath, source)
}

/**
 * Encodes the frames as H.264, which is what a walkthrough should ship as: a
 * video can be paused, seeked, and asked what time it is, so the UI showing it
 * can hold on a step a reader clicked and highlight the step actually playing
 * rather than guessing from a clock. It is also a fraction of a GIF's weight.
 *
 * Even frame counts and yuv420p because H.264 needs even dimensions and
 * browsers will not decode anything else; faststart so the video can start
 * before it has fully downloaded.
 */
function assembleVideo(
  framesDir: string,
  outFile: string,
  fps: number,
  outputWidth?: number | undefined,
): void {
  const scale = outputWidth
    ? `scale=${outputWidth}:-2:flags=lanczos`
    : 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(framesDir, 'f%04d.png'),
      '-vf',
      scale,
      '-c:v',
      'libx264',
      '-preset',
      'veryslow',
      // Text has to stay readable, and a 30-second screen recording is small at
      // this quality anyway.
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outFile,
    ],
    { stdio: 'ignore' },
  )
  if (result.error || result.status !== 0) {
    throw new Error(
      'ffmpeg failed to encode the video; is it installed (brew install ffmpeg)?',
    )
  }
}

/**
 * Assembles the frames into a GIF.
 *
 * The encoder settings are about weight, because a walkthrough that scrolls is
 * expensive: a scrolled frame shares nothing with the one before it, so GIF's
 * between-frame compression has nothing to reuse. Dithering makes that worse by
 * scattering noise over flat UI, which is why this asks for none — a dashboard
 * screenshot is flat colour and looks cleaner without it. Downscaling to
 * roughly the width the image is displayed at is the other half; recording at
 * full size keeps the layout honest, and the output does not have to carry
 * pixels nobody sees.
 */
function assembleGif(
  framesDir: string,
  outFile: string,
  fps: number,
  outputWidth?: number | undefined,
): void {
  const filter = [
    `fps=${fps}`,
    `scale=${outputWidth ?? 'iw'}:-1:flags=bilinear`,
    'split[a][b]',
    '[a]palettegen=max_colors=64[p]',
    '[b][p]paletteuse=dither=none',
  ].join(',')
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(framesDir, 'f%04d.png'),
      '-vf',
      filter,
      '-loop',
      '0',
      outFile,
    ],
    { stdio: 'ignore' },
  )
  if (result.error || result.status !== 0) {
    throw new Error(
      'ffmpeg failed to assemble the GIF; is it installed (brew install ffmpeg)?',
    )
  }
}

export async function recordWalkthrough(config: {
  keepFrames: boolean
  outFile: string
  profilePath: string
  timelineFile?: string | undefined
}): Promise<void> {
  const { keepFrames, outFile, profilePath, timelineFile } = {
    __proto__: null,
    ...config,
  } as typeof config
  const raw = await readFile(profilePath, 'utf8')
  // Profiles may point at a checked-in mockup with file:///REPO/…, which only
  // this process can expand to an absolute path.
  const profile = JSON.parse(
    raw.replaceAll('/REPO/', () => `${process.cwd()}/`),
  ) as WalkthroughProfile
  const framesDir = path.join(
    os.tmpdir(),
    `ui-walkthrough-${path.basename(profilePath, '.json')}`,
  )
  safeDeleteSync(framesDir)
  mkdirSync(framesDir, { recursive: true })

  // The shared durable profile, through the fleet's one sanctioned
  // launchPersistentContext call. A throwaway profile would re-solve sign-in
  // and human verification on every run.
  const session = await openNpmBrowserSession({ scope: 'record-walkthrough' })
  const { page } = session
  try {
    await page.setViewportSize(profile.viewport ?? { height: 620, width: 1000 })

    if (profile.login) {
      await page.goto(profile.login.loginUrl)
      await page.getByRole('button', { name: 'Continue with Email' }).click()
      const email = page.getByRole('textbox', { name: 'Email address' })
      await email.fill(profile.login.email)
      await email.press('Enter')
      await page.waitForURL(/dashboard/, { timeout: 30_000 })
    }

    await page.goto(profile.startUrl)
    await page.evaluate(OVERLAY_SOURCE)

    const recorder = new Recorder(page, framesDir)
    await recorder.shoot(5)
    const fps = profile.fps ?? 10
    const spans: GuideSpan[] = []
    for (const step of profile.steps) {
      if (step.guideStep) {
        const previous = spans.at(-1)
        if (previous) {
          previous.endFrame = recorder.frames
        }
        spans.push({
          endFrame: recorder.frames,
          key: step.guideStep,
          startFrame: recorder.frames,
        })
      }
      await runStep(page, recorder, step, rippleStages(fps))
    }
    const last = spans.at(-1)
    if (last) {
      last.endFrame = recorder.frames
    }
    // The extension picks the encoder: .mp4 for anywhere the player can be
    // driven by code, .gif only where an <img> is all that can be embedded.
    if (outFile.endsWith('.gif')) {
      assembleGif(framesDir, outFile, fps, profile.outputWidth)
    } else {
      assembleVideo(framesDir, outFile, fps, profile.outputWidth)
    }
    logger.info(`${outFile} (${recorder.frames} frames)`)
    if (timelineFile) {
      writeTimelineModule({
        fps,
        profilePath,
        spans,
        targetPath: timelineFile,
        totalFrames: recorder.frames,
      })
      logger.info(`${timelineFile} (${spans.length} steps)`)
    }
  } finally {
    await session.close()
    if (!keepFrames) {
      safeDeleteSync(framesDir)
    } else {
      writeFileSync(
        path.join(framesDir, 'README'),
        'frames kept via --keep-frames\n',
      )
    }
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'records a browser walkthrough as a video with a drawn pointer and click ripples',
  help: 'Usage: record-walkthrough.mts <profile.json> [--out <file.mp4>] [--timeline <file.ts>] [--keep-frames]',
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (!argv.length) {
    logger.info(SCRIPT_META.help)
    return 1
  }
  const profilePath = argv[0]!
  const outIndex = argv.indexOf('--out')
  const outFile =
    outIndex >= 0 && argv[outIndex + 1]
      ? argv[outIndex + 1]!
      : `${path.basename(profilePath, '.json')}.mp4`
  const timelineIndex = argv.indexOf('--timeline')
  await recordWalkthrough({
    keepFrames: argv.includes('--keep-frames'),
    outFile,
    profilePath,
    timelineFile: timelineIndex >= 0 ? argv[timelineIndex + 1] : undefined,
  })
  return 0
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
