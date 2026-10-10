/**
 * Stretches of a ride the map cannot draw but the charts still fill.
 *
 * Read from the same fixes the map draws from: no point on the map means a gap here, by
 * construction. Only inside a stretch that was actually being recorded, though — a paused
 * recording has no fixes for a good reason, and marking that as a fault is noise.
 */
const GPS_GAP_MIN_MS = 10_000
/** Board samples further apart than this were not one continuous recording. */
const RECORDING_BREAK_MS = 10_000

export interface GpsGapRange {
  startMs: number
  endMs: number
}

export function toGpsGapRanges(
  gpsSamples: readonly { capturedAtMs: number }[],
  sampleTimes: readonly number[],
  minGapMs: number = GPS_GAP_MIN_MS,
): GpsGapRange[] {
  const fixes = gpsSamples.map((sample) => sample.capturedAtMs).sort((a, b) => a - b)
  const gaps: GpsGapRange[] = []

  for (const span of recordingSpans(sampleTimes)) {
    const inSpan = fixes.filter((ms) => ms >= span.startMs && ms <= span.endMs)
    const edges = [span.startMs, ...inSpan, span.endMs]
    for (let index = 1; index < edges.length; index += 1) {
      const startMs = edges[index - 1]
      const endMs = edges[index]
      if (endMs - startMs >= minGapMs) gaps.push({ startMs, endMs })
    }
  }

  return gaps
}

/** The ride broken into the stretches it was recording without a break. */
function recordingSpans(sampleTimes: readonly number[]): GpsGapRange[] {
  const times = [...sampleTimes].sort((a, b) => a - b)
  if (times.length < 2) return []

  const spans: GpsGapRange[] = []
  let startMs = times[0]
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] - times[index - 1] <= RECORDING_BREAK_MS) continue
    if (times[index - 1] > startMs) spans.push({ startMs, endMs: times[index - 1] })
    startMs = times[index]
  }
  const endMs = times[times.length - 1]
  if (endMs > startMs) spans.push({ startMs, endMs })
  return spans
}
