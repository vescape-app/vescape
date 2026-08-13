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

export interface ChartPlotBox {
  x: number
  y: number
  width: number
  height: number
}
