/**
 * @file The report's charts, and the one rule about where dither is allowed.
 *   DITHER BELONGS ONLY UNDER A LINE. A dithered cell ramp reads as a texture
 *   with a direction, which is what makes it useful for the AREA under a series
 *   over its y-axis: the fill says "this much of the axis" without a second
 *   colour. In a share or ranking cell it does the opposite - the eye reads the
 *   texture as a value and stops measuring, so two rows a few percent apart
 *   look identical. Those cells get a solid bar whose LENGTH is the only
 *   variable. BARS ARE LENGTH, NOTHING ELSE. One fill, no gradient, no texture.
 *   A reader comparing rows is comparing lengths, and every other visual axis
 *   is noise competing with the one that carries the data. THE DRILL-IN IS
 *   EVERY 5%. A reader asking "what is in that band" wants a bucket, not a
 *   tooltip on one point. Five points is the finest band that still holds
 *   enough rows to be worth opening, and it divides 100 evenly so no band is a
 *   different width from its neighbours.
 */

/**
 * The dither ramp, lightest to solid. Only ever used under a line.
 */
export const DITHER_RAMP: readonly string[] = ['░', '▒', '▓', '█']

/**
 * How wide a drill-in band is, in percentage points.
 */
export const DRILL_BAND_PCT = 5

export interface ChartPoint {
  readonly label: string
  readonly value: number
}

/**
 * A solid share bar: length is the value, and nothing else varies.
 *
 * `width` is the cell count, so a caller picks the resolution rather than this
 * assuming one. Out-of-range values clamp; a bar longer than its track would
 * read as more than the whole.
 */
export function solidBar(share: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round(share * width)))
  return `${'█'.repeat(filled)}${'·'.repeat(width - filled)}`
}

/**
 * The dithered column under one point of a line, over the y-axis.
 *
 * The column is `height` cells tall and fills from the bottom, with the topmost
 * filled cell taking a lighter ramp step so the surface reads as a boundary
 * rather than a wall. This is the ONLY sanctioned use of the ramp.
 */
export function ditherColumn(fraction: number, height: number): string[] {
  const clamped = Math.max(0, Math.min(1, fraction))
  const exact = clamped * height
  const whole = Math.floor(exact)
  const cells: string[] = []
  for (let row = height - 1; row >= 0; row -= 1) {
    if (row < whole) {
      cells.push(DITHER_RAMP[3]!)
      continue
    }
    if (row === whole) {
      const partial = exact - whole
      cells.push(
        partial >= 0.66
          ? DITHER_RAMP[2]!
          : partial >= 0.33
            ? DITHER_RAMP[1]!
            : partial > 0
              ? DITHER_RAMP[0]!
              : ' ',
      )
      continue
    }
    cells.push(' ')
  }
  return cells
}

/**
 * A line chart as rows of text, dithered under the series.
 *
 * Rendered as text rather than SVG because the report must stay portable: one
 * self-contained file with no fetched font, no plotting library, and nothing
 * that stops rendering when a CDN is unreachable.
 */
export function renderLineChart(
  points: readonly ChartPoint[],
  height: number,
): string[] {
  if (points.length === 0) {
    return []
  }
  let peak = 0
  for (let i = 0, { length } = points; i < length; i += 1) {
    peak = Math.max(peak, points[i]!.value)
  }
  const columns = points.map(point =>
    ditherColumn(peak > 0 ? point.value / peak : 0, height),
  )
  const rows: string[] = []
  for (let row = 0; row < height; row += 1) {
    let line = ''
    for (let col = 0, { length } = columns; col < length; col += 1) {
      line += columns[col]![row]!
    }
    rows.push(line)
  }
  return rows
}

export interface DrillBand {
  /**
   * Inclusive lower bound, in percentage points.
   */
  readonly fromPct: number
  readonly rows: readonly ChartPoint[]
  /**
   * Exclusive upper bound, except the top band which includes 100.
   */
  readonly toPct: number
}

/**
 * Bucket rows into 5-point bands by their share of the peak.
 *
 * Empty bands are dropped: a drill-in listing twenty bands where sixteen say
 * nothing buries the four that matter. The top band includes 100 so the peak
 * row has somewhere to land.
 */
export function drillBands(
  points: readonly ChartPoint[],
  bandPct: number = DRILL_BAND_PCT,
): DrillBand[] {
  let peak = 0
  for (let i = 0, { length } = points; i < length; i += 1) {
    peak = Math.max(peak, points[i]!.value)
  }
  const buckets = new Map<number, ChartPoint[]>()
  for (let i = 0, { length } = points; i < length; i += 1) {
    const point = points[i]!
    const share = peak > 0 ? (point.value / peak) * 100 : 0
    const floor = Math.min(100 - bandPct, Math.floor(share / bandPct) * bandPct)
    const bucket = buckets.get(floor)
    if (bucket) {
      bucket.push(point)
    } else {
      buckets.set(floor, [point])
    }
  }
  return [...buckets.entries()]
    .toSorted(([left], [right]) => right - left)
    .map(([fromPct, rows]) => ({
      fromPct,
      rows,
      toPct: fromPct + bandPct,
    }))
}
