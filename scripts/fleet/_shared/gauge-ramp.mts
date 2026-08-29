/**
 * @file The colours the spend gauges are painted with. Two ramps, and which one
 *   a gauge draws from depends on how full it is. ONE SOLID COLOUR PER BAR, NOT
 *   PER CELL. A bar whose cells each take a different colour reads as a rainbow
 *   rather than as an instrument, and the shading already carries the level.
 *   Each gauge is painted one flat colour, so the four of them read as one
 *   cluster of related dials. THE COLOUR IS ITS POSITION IN THE CLUSTER. While
 *   a tank is healthy, gauge `i` takes a step along a blue-purple-pink ramp, so
 *   the Claude seat, then Fireworks, then Synthetic, then Codex each sit a
 *   shade further toward pink. That makes a gauge identifiable by colour alone
 *   at a glance, which is the whole reason to have four of them on one line.
 *   LOW TANKS LEAVE THE BRAND RAMP ENTIRELY. Once a gauge drops past
 *   {@link WARM_FLOOR} it stops taking its identity colour and steps along the
 *   warning ramp instead - mustard, orange, rust. Draining gauges converge on
 *   the same warm family rather than each staying its own brand shade, because
 *   at that point which dial it is matters less than that it is nearly empty.
 *   Rust is named here rather than read from the palette: the palette's bottom
 *   is a salmon `error` red that reads as a fault, and an empty offload tank is
 *   a budget signal. A DRAINING GAUGE STAYS VIVID. The crossing between the two
 *   ramps is a blend, and a blend of two colours from opposite sides of the
 *   wheel passes through grey on its way across. Grey is the one thing a gauge
 *   must never be: a washed-out dial reads as a seat that is UNAVAILABLE, not
 *   as one that is nearly spent. {@link mixVividRgb} is what keeps the two
 *   readings apart.
 */

export interface Rgb {
  readonly b: number
  readonly g: number
  readonly r: number
}

/**
 * The healthy ramp, walked ACROSS the gauges. Blue anchors the cool end, Socket
 * purple and Socket pink are the palette's own identity colours, so a full
 * cluster reads as the product rather than as a status.
 */
export const IDENTITY_RAMP: readonly string[] = [
  '#5b8cff',
  '#8c50ff',
  '#c93ad4',
  '#ff00aa',
]

/**
 * The low ramp, walked across the gauges the same way. Mustard and orange come
 * from the palette's `warning` and `alert` slots; rust closes it.
 */
export const WARM_RAMP: readonly string[] = [
  '#facc15',
  '#fb923c',
  '#e2622a',
  '#9a3412',
]

/**
 * Where a gauge stops taking its identity colour and starts warming. Half a
 * tank: high enough that a gauge announces itself well before it is a problem,
 * low enough that the cluster is not permanently orange.
 */
export const WARM_FLOOR = 0.5

/**
 * Parse `#rrggbb`. Throws on anything else rather than guessing: every caller
 * passes a literal from this file, so a bad value is a typo to surface at the
 * first test run, not a colour to silently approximate.
 */
export function hexToRgb(hex: string): Rgb {
  const match = /^#(?<hex>[0-9a-fA-F]{6})$/.exec(hex)
  if (!match?.groups) {
    throw new Error(
      `Invalid gauge colour "${hex}". Where: hexToRgb. Saw a value that is not #rrggbb; wanted six hex digits after a hash. Fix: correct the stop in IDENTITY_RAMP or WARM_RAMP.`,
    )
  }
  const value = Number.parseInt(match.groups['hex']!, 16)
  return {
    b: value & 0xff,
    g: (value >> 8) & 0xff,
    r: (value >> 16) & 0xff,
  }
}

/**
 * Mix two colours, `t` running 0 (all `from`) to 1 (all `to`).
 */
export function mixRgb(from: Rgb, to: Rgb, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t))
  return {
    b: Math.round(from.b + (to.b - from.b) * clamped),
    g: Math.round(from.g + (to.g - from.g) * clamped),
    r: Math.round(from.r + (to.r - from.r) * clamped),
  }
}

export interface Hsl {
  /**
   * Hue in degrees, 0 to 360.
   */
  readonly h: number
  /**
   * Lightness, 0 (black) to 1 (white).
   */
  readonly l: number
  /**
   * Saturation, 0 (a neutral grey) to 1 (fully vivid).
   */
  readonly s: number
}

/**
 * Split a colour into hue, saturation and lightness. Saturation is the channel
 * worth having: it is the difference between a colour the eye reads as a signal
 * and one it reads as switched off.
 */
export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min
  // A grey has no hue to report, and the saturation divisor below would be the
  // one that vanishes at pure black and pure white.
  if (delta === 0) {
    return { h: 0, l, s: 0 }
  }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) {
    h = 60 * (((g - b) / delta + 6) % 6)
  } else if (max === g) {
    h = 60 * ((b - r) / delta + 2)
  } else {
    h = 60 * ((r - g) / delta + 4)
  }
  return { h, l, s }
}

/**
 * Rebuild a colour from hue, saturation and lightness.
 */
export function hslToRgb(hsl: Hsl): Rgb {
  const { h, l, s } = hsl
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const sector = (((h % 360) + 360) % 360) / 60
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const base = l - chroma / 2
  let channels: readonly [number, number, number]
  if (sector < 1) {
    channels = [chroma, second, 0]
  } else if (sector < 2) {
    channels = [second, chroma, 0]
  } else if (sector < 3) {
    channels = [0, chroma, second]
  } else if (sector < 4) {
    channels = [0, second, chroma]
  } else if (sector < 5) {
    channels = [second, 0, chroma]
  } else {
    channels = [chroma, 0, second]
  }
  return {
    b: Math.round((channels[2] + base) * 255),
    g: Math.round((channels[1] + base) * 255),
    r: Math.round((channels[0] + base) * 255),
  }
}

/**
 * Mix two colours the way {@link mixRgb} does, then refuse to let the blend be
 * duller than either colour that went into it.
 *
 * Channel-wise mixing walks a straight line through the colour cube, and when
 * the endpoints sit on opposite sides of the wheel that line passes close to
 * the cube's grey diagonal. Blue `#5b8cff` toward mustard `#facc15` is exactly
 * that case: the middle of the drain is a khaki near a quarter of the
 * saturation of either end. On a statusline the operator reads that washed-out
 * gauge as a seat that is UNAVAILABLE, so the drain warning it is meant to be
 * lands as the opposite - a dial worth ignoring.
 *
 * Hue and lightness are left exactly where the straight-line mix put them, so
 * the gauge still crosses smoothly from its identity colour to the warning
 * family and still reads as further gone the emptier it is. Only saturation is
 * held up, to the floor the two endpoints already agree on. The lift is
 * one-directional: a blend that is vivid enough on its own is returned
 * untouched, which keeps the ends of the ramp bit-exact.
 */
export function mixVividRgb(from: Rgb, to: Rgb, t: number): Rgb {
  const mixed = mixRgb(from, to, t)
  const mixedHsl = rgbToHsl(mixed)
  const floor = Math.min(rgbToHsl(from).s, rgbToHsl(to).s)
  if (mixedHsl.s >= floor) {
    return mixed
  }
  return hslToRgb({ h: mixedHsl.h, l: mixedHsl.l, s: floor })
}

/**
 * Sample a ramp at `t`, from 0 (first stop) to 1 (last), interpolating between
 * the two stops it falls between.
 */
export function sampleRamp(stops: readonly string[], t: number): Rgb {
  if (stops.length === 0) {
    throw new Error(
      `Empty colour ramp. Where: sampleRamp. Saw no stops; wanted at least one. Fix: restore the stops in IDENTITY_RAMP or WARM_RAMP.`,
    )
  }
  if (stops.length === 1) {
    return hexToRgb(stops[0]!)
  }
  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (stops.length - 1)
  const lower = Math.floor(scaled)
  const upper = Math.min(stops.length - 1, lower + 1)
  return mixRgb(
    hexToRgb(stops[lower]!),
    hexToRgb(stops[upper]!),
    scaled - lower,
  )
}

export interface GaugeColorConfig {
  /**
   * Which gauge this is, left to right.
   */
  readonly index: number
  /**
   * How many gauges share the line, so the step between them is even.
   */
  readonly total: number
  /**
   * How full this gauge is, 0 to 1. Undefined for a gauge nothing meters, which
   * takes its identity colour rather than being read as empty.
   */
  readonly remaining?: number | undefined
}

/**
 * The one solid colour a gauge is painted.
 *
 * Position picks the step along whichever ramp applies, so a gauge keeps its
 * place in the cluster whether it is healthy or draining - the RAMP changes,
 * not the gauge's position on it.
 */
export function gaugeColor(config: GaugeColorConfig): Rgb {
  const cfg = { __proto__: null, ...config } as GaugeColorConfig
  const step = cfg.total <= 1 ? 0 : cfg.index / (cfg.total - 1)
  const { remaining } = cfg
  if (remaining === undefined || remaining >= WARM_FLOOR) {
    return sampleRamp(IDENTITY_RAMP, step)
  }
  // Below the floor the gauge crosses to the warning family, and keeps crossing
  // as it drains: at the floor it is barely warm, at empty it is fully rust.
  // The crossing goes through mixVividRgb rather than mixRgb because a plain
  // blend of the two ramps is at its dullest in the MIDDLE of the drain, which
  // is where the warning matters most. A low gauge and an unmetered one have to
  // stay tellable apart by colour alone.
  const identity = sampleRamp(IDENTITY_RAMP, step)
  const warm = sampleRamp(WARM_RAMP, step)
  const depth = 1 - remaining / WARM_FLOOR
  return mixVividRgb(identity, warm, depth)
}

/**
 * A 24-bit foreground escape for an RGB triple.
 */
export function ansiFg(rgb: Rgb): string {
  return `\u001B[38;2;${rgb.r};${rgb.g};${rgb.b}m`
}

export const ANSI_RESET = '\u001B[39m'

/**
 * Paint text one solid colour.
 */
export function paintSolid(text: string, rgb: Rgb): string {
  return `${ansiFg(rgb)}${text}${ANSI_RESET}`
}

export interface NameMeterConfig {
  readonly color?: boolean | undefined
  /**
   * The model (or seat) name the meter carries. Longer than the width: hard
   * truncation at the left anchor. Shorter: centred in the cells.
   */
  readonly name: string
  /**
   * The verifying pulse, phase-selected by the caller, which owns the clock:
   * true renders the LIGHTER end of the unmetered wash, false the deeper one.
   * Ignored when the seat is metered - a pulse is the claim "being verified",
   * and a seat with a reading has nothing to verify.
   */
  readonly pulsePhase?: boolean | undefined
  /**
   * How full the tank is, 0 to 1, or undefined when nothing meters the seat -
   * which draws the whole name in the MIDDLE tone, the same claim the shaded
   * unmetered cell used to make: there is a limit, and this machine cannot
   * see where the seat stands against it.
   */
  readonly remaining: number | undefined
  /**
   * The gauge's solid colour - the BRIGHT zone. The empty zone is the same
   * colour at roughly a third of the brightness, so the fill reads as one
   * colour gaining strength rather than two colours next to each other.
   */
  readonly rgb: Rgb
  readonly width?: number | undefined
}

/**
 * The compact gauge: the model's name IS the bar. The name's letters carry
 * the fill - bright up to the level, one transition letter at the boundary,
 * dim after it - so the reading lives in the colour rather than in a
 * percentage that costs four cells beside the bar. At 50% a centred name
 * lights its left half. Colour off, the painted zones collapse to the plain
 * bracketed name: the glyph bar is the better reading there, and the caller
 * keeps it.
 */
const WHITE: Rgb = { b: 255, g: 255, r: 255 }

/**
 * A 24-bit background escape for an RGB triple.
 */
export function ansiBg(rgb: Rgb): string {
  return `\u001B[48;2;${rgb.r};${rgb.g};${rgb.b}m`
}

const ANSI_BG_RESET = '\u001B[49m'

/**
 * The compact gauge: a background bar in character space with the model's
 * name written on top. Three tones of ONE colour, so the eye reads the level
 * before it reads the name: the model text is the gauge's full colour (the
 * strongest tone), the filled bar is the colour washed toward white (lighter
 * than the text), and the empty bar is the same wash pushed further (the
 * most faded). One transition cell at the boundary sits between the two.
 * Colour off, the zones collapse to the plain bracketed name.
 */
export function paintGaugeBar(config: NameMeterConfig): string {
  const cfg = { __proto__: null, ...config } as NameMeterConfig
  const width = cfg.width ?? 8
  const name = cfg.name.length > width ? cfg.name.slice(0, width) : cfg.name
  const padTotal = width - name.length
  const padLeft = Math.floor(padTotal / 2)
  const padRight = padTotal - padLeft
  if (cfg.color !== true) {
    return `[${' '.repeat(padLeft)}${name}${' '.repeat(padRight)}]`
  }
  const textFg = cfg.rgb
  const emptyBg = mixRgb(cfg.rgb, WHITE, 0.85)
  if (cfg.remaining === undefined) {
    // Unmetered: one mid wash across the whole name - there is a limit, and
    // this machine cannot see where the seat stands against it. When the
    // caller marks the seat as verifying, the wash breathes between two
    // tones: the slowest pulse reads as "thinking", never as a new state.
    const midBg =
      cfg.pulsePhase === undefined
        ? mixRgb(cfg.rgb, WHITE, 0.7)
        : cfg.pulsePhase
          ? mixRgb(cfg.rgb, WHITE, 0.55)
          : mixRgb(cfg.rgb, WHITE, 0.82)
    return `[${ansiBg(midBg)}${' '.repeat(padLeft)}${ansiFg(textFg)}${name}${' '.repeat(padRight)}${ANSI_RESET}${ANSI_BG_RESET}]`
  }
  const fillBg = mixRgb(cfg.rgb, WHITE, 0.55)
  const transitionBg = mixRgb(cfg.rgb, WHITE, 0.35)
  const snapped = Math.round(cfg.remaining * 100) / 100
  const fillChars = snapped * name.length
  const whole = Math.floor(fillChars)
  const hasTransition = fillChars - whole >= 0.33 && whole < name.length
  const fillZone = name.slice(0, whole)
  const transitionChar = hasTransition ? (name[whole] ?? '') : ''
  const emptyZone = name.slice(hasTransition ? whole + 1 : whole)
  // The pads are bar space too: the left pad fills with the tank (empty only
  // at a dead-zero reading). The right pad inherits whatever zone the name
  // ended on - the empty wash for any partial tank, the fill for a full one.
  const padLeftBg = snapped <= 0 ? ansiBg(emptyBg) : ansiBg(fillBg)
  return (
    `[${padLeftBg}${' '.repeat(padLeft)}` +
    (fillZone === '' ? '' : `${ansiFg(textFg)}${fillZone}`) +
    (transitionChar === ''
      ? ''
      : `${ansiBg(transitionBg)}${ansiFg(textFg)}${transitionChar}`) +
    (emptyZone === ''
      ? ''
      : `${ansiBg(emptyBg)}${ansiFg(textFg)}${emptyZone}`) +
    `${' '.repeat(padRight)}${ANSI_RESET}${ANSI_BG_RESET}]`
  )
}
