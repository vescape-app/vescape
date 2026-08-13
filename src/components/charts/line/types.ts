/**
 * Chart data crosses to the UI thread on every pinch frame, so a series is two parallel
 * number arrays rather than an array of objects: `Date` cannot be copied into a worklet,
 * and per-point objects would make each Reanimated copy proportional to allocation count.
 */
export interface ChartSeriesData {
  /** Epoch ms, strictly ascending. */
  ts: number[]
  vs: number[]
}

export interface ChartViewport {
  startMs: number
  endMs: number
}

export interface ChartYRange {
  min: number
  max: number
}

/**
 * Camera shared by every chart of a stack. `endMs: null` means "follow the live head", so a
 * live chart needs no per-frame writes as data arrives — the head is a separate shared value
 * and the viewport is derived from both.
 */
export interface ChartCamera {
  spanMs: number
  endMs: number | null
  /**
   * Dataset the camera was aimed at. Comparing it against the dataset being drawn is what
   * resets zoom when the rider opens a different ride — a comparison rather than an effect, so
   * a new dataset can never be drawn through the previous dataset's viewport, not even for a
   * frame.
   */
  key: string
}

export interface ChartColorStop {
  /** In the metric's own units, on the axis the series is drawn against. */
  value: number
  color: string
}

/**
 * Colour as a function of value — a speed line running blue to red, a duty line greening into
 * amber near its limit.
 *
 * Expressed as a ramp rather than a colour per point on purpose. The colour of a sample depends
 * only on its value, and value maps to a fixed y, so the whole ramp is one vertical gradient
 * over the plot: it is unaffected by panning or zooming and is built once per render. Colouring
 * points individually would mean rebuilding a gradient stop per sample on every frame, which is
 * what made the old chart's speed gradient the expensive series to draw.
 */
export interface ChartColorRamp {
  /** Any order; sorted on use. A single stop is just a solid colour. */
  stops: ChartColorStop[]
  /** `bands` holds each colour flat up to the next stop; `smooth` blends between them. */
  mode?: 'smooth' | 'bands'
}

/** A stretch of time, in epoch ms. */
export interface ChartTimeRange {
  startMs: number
  endMs: number
}

/**
 * A stretch of time called out under the line — a segment excluded from the stats, a favourite
 * lap, a fault window.
 *
 * Drawn as a hairline along the floor of the plot rather than a block behind the line: the line
 * is what the rider is reading, and a full-height wash competes with it. Bands sharing a colour
 * and a row are drawn as one path, so a ride with hundreds of excluded stretches still costs a
 * handful of nodes.
 */
export interface ChartBand extends ChartTimeRange {
  color: string
  /** Which hairline to sit on, counting up from the floor. Keeps two kinds from overlapping. */
  row?: number
}

export interface ChartPlotBox {
  x: number
  y: number
  width: number
  height: number
}
