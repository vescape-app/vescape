/**
 * A ride with its long idle stretches cut out.
 *
 * A ride that sat still for forty minutes spends most of the plot drawing that stillness, and the
 * riding either side of it is squeezed into what is left. The timeline maps real time onto a
 * shorter *chart time* where every long pause collapses to a sliver, and back again — so the chart
 * draws the compacted ride while everything outside it (the map, the trimmer, the stats) keeps
 * speaking in real timestamps.
 *
 * Segments are held as parallel arrays of numbers so the whole thing crosses to the UI thread as
 * plain data and both conversions can run inside a worklet.
 */
export interface ChartTimeline {
  /** Real bounds of each kept stretch, ascending and non-overlapping. */
  realStartMs: number[]
  realEndMs: number[]
  /** Where each kept stretch begins in chart time. */
  chartStartMs: number[]
  /** Real bounds of each cut, for labelling it. One shorter than the segment arrays. */
  gapStartMs: number[]
  gapEndMs: number[]
  /** Chart time each cut sits at — the seam between two segments. */
  gapChartMs: number[]
  /** Width a cut occupies in chart time. */
  gapWidthMs: number
}

export interface TimelineOptions {
  /** Idle longer than this is cut. */
  minGapMs: number
  /** What a cut is worth on the x axis once collapsed. */
  gapWidthMs: number
}

/**
 * Cut the long pauses out of a sorted list of sample times.
 *
 * Returns `null` when there is nothing to cut, which is the common case: an identity timeline
 * would make every projection pay for a conversion that cannot change anything.
 */
export function buildTimeline(
  ts: number[],
  { minGapMs, gapWidthMs }: TimelineOptions,
): ChartTimeline | null {
  if (ts.length < 2) return null

  const realStartMs: number[] = [ts[0]]
  const realEndMs: number[] = []
  const gapStartMs: number[] = []
  const gapEndMs: number[] = []

  for (let i = 1; i < ts.length; i += 1) {
    if (ts[i] - ts[i - 1] <= minGapMs) continue
    realEndMs.push(ts[i - 1])
    realStartMs.push(ts[i])
    gapStartMs.push(ts[i - 1])
    gapEndMs.push(ts[i])
  }
  if (gapStartMs.length === 0) return null
  realEndMs.push(ts[ts.length - 1])

  const chartStartMs: number[] = []
  const gapChartMs: number[] = []
  let chartMs = ts[0]
  for (let i = 0; i < realStartMs.length; i += 1) {
    chartStartMs.push(chartMs)
    chartMs += realEndMs[i] - realStartMs[i]
    if (i < gapStartMs.length) {
      gapChartMs.push(chartMs)
      chartMs += gapWidthMs
    }
  }

  return { realStartMs, realEndMs, chartStartMs, gapStartMs, gapEndMs, gapChartMs, gapWidthMs }
}

/** Index of the last segment starting at or before `value`, by the given key. */
function segmentAt(starts: number[], value: number): number {
  'worklet'
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= value) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Where a real moment falls on the chart. Moments inside a cut land within its sliver. */
export function toChartMs(realMs: number, timeline: ChartTimeline | null): number {
  'worklet'
  if (timeline == null) return realMs
  const { realStartMs, realEndMs, chartStartMs, gapWidthMs } = timeline
  const i = segmentAt(realStartMs, realMs)
  const chartStart = chartStartMs[i]
  if (realMs <= realStartMs[i]) return chartStart
  const span = realEndMs[i] - realStartMs[i]
  if (realMs <= realEndMs[i]) return chartStart + (realMs - realStartMs[i])
  // Inside the cut that follows: spread it across the sliver, so the mapping stays monotonic and
  // invertible rather than snapping a whole pause onto one instant.
  const gapSpan = realStartMs[i + 1] - realEndMs[i]
  if (i + 1 >= realStartMs.length || gapSpan <= 0) return chartStart + span
  return chartStart + span + ((realMs - realEndMs[i]) / gapSpan) * gapWidthMs
}

/** The inverse: what real moment a point on the chart stands for. */
export function toRealMs(chartMs: number, timeline: ChartTimeline | null): number {
  'worklet'
  if (timeline == null) return chartMs
  const { realStartMs, realEndMs, chartStartMs, gapWidthMs } = timeline
  const i = segmentAt(chartStartMs, chartMs)
  const offset = chartMs - chartStartMs[i]
  const span = realEndMs[i] - realStartMs[i]
  if (offset <= 0) return realStartMs[i]
  if (offset <= span) return realStartMs[i] + offset
  if (i + 1 >= realStartMs.length || gapWidthMs <= 0) return realEndMs[i]
  const gapSpan = realStartMs[i + 1] - realEndMs[i]
  return realEndMs[i] + ((offset - span) / gapWidthMs) * gapSpan
}
