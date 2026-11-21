export interface ChartTimeline {
  realStartMs: number[]
  realEndMs: number[]
  chartStartMs: number[]
  gapStartMs: number[]
  gapEndMs: number[]
  gapChartMs: number[]
  gapWidthMs: number
}

export interface TimelineOptions {
  minGapMs: number
  gapWidthMs: number
}

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

export function toChartMs(realMs: number, timeline: ChartTimeline | null): number {
  'worklet'
  if (timeline == null) return realMs
  const { realStartMs, realEndMs, chartStartMs, gapWidthMs } = timeline
  const i = segmentAt(realStartMs, realMs)
  const chartStart = chartStartMs[i]
  if (realMs <= realStartMs[i]) return chartStart
  const span = realEndMs[i] - realStartMs[i]
  if (realMs <= realEndMs[i]) return chartStart + (realMs - realStartMs[i])
  const gapSpan = realStartMs[i + 1] - realEndMs[i]
  if (i + 1 >= realStartMs.length || gapSpan <= 0) return chartStart + span
  return chartStart + span + ((realMs - realEndMs[i]) / gapSpan) * gapWidthMs
}

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
