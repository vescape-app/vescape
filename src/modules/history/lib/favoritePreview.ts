import type { HistoryGpsSample, TelemetrySample } from 'vescape-core'

/**
 * Stats shown live while trimming a Favorite. A best-effort JS preview from the already-loaded
 * ride samples — the durable Favorite summary is recomputed natively at save (slice 1). Field names
 * mirror {@link HistorySession} so a trim preview can be spread over the selected session and fed to
 * the existing stats bar unchanged.
 */
export interface FavoriteRangeStats {
  sampleCount: number
  distanceM: number | null
  maxSpeedKmh: number
  avgSpeedKmh: number
  maxTempMosfet: number | null
  maxTempMotor: number | null
  maxDuty: number
  batteryUsedWh: number
  batteryRegenWh: number
}

// Board samples that straddle a long recording gap should not integrate energy across the gap.
const MAX_ENERGY_INTEGRATION_GAP_MS = 5_000

const EMPTY_STATS: FavoriteRangeStats = {
  sampleCount: 0,
  distanceM: null,
  maxSpeedKmh: 0,
  avgSpeedKmh: 0,
  maxTempMosfet: null,
  maxTempMotor: null,
  maxDuty: 0,
  batteryUsedWh: 0,
  batteryRegenWh: 0,
}

/**
 * Summarize a trimmed time range from ride samples. `samples` and `gpsSamples` must be sorted
 * ascending by `capturedAtMs` — the caller sorts once per session, not per drag frame. Range bounds
 * are order-independent; `[a, b]` and `[b, a]` summarize the same span.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/FavoriteSummaryBuilder.kt `buildFavoriteSummary`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `favoriteSummary`
 * @platform-diff This is a best-effort UI preview over already-loaded samples; native recomputes
 * durable stats with Metric Sanitizers and persisted bucket semantics when the Favorite is saved.
 */
export function summarizeFavoriteRange(
  samples: TelemetrySample[],
  gpsSamples: HistoryGpsSample[],
  startMs: number,
  endMs: number,
): FavoriteRangeStats {
  const lo = Math.min(startMs, endMs)
  const hi = Math.max(startMs, endMs)

  let sampleCount = 0
  let speedSum = 0
  let maxSpeedKmh = 0
  let maxDuty = 0
  let maxTempMosfet: number | null = null
  let maxTempMotor: number | null = null
  let batteryUsedWh = 0
  let batteryRegenWh = 0
  let previous: TelemetrySample | null = null

  for (const sample of samples) {
    if (sample.capturedAtMs < lo) {
      previous = sample
      continue
    }
    if (sample.capturedAtMs > hi) break

    sampleCount += 1
    const speed = Math.abs(sample.speedKmh)
    speedSum += speed
    maxSpeedKmh = Math.max(maxSpeedKmh, speed)
    maxDuty = Math.max(maxDuty, sample.dutyCycle)
    if (sample.tempMosfet != null) {
      maxTempMosfet =
        maxTempMosfet == null ? sample.tempMosfet : Math.max(maxTempMosfet, sample.tempMosfet)
    }
    if (sample.tempMotor != null) {
      maxTempMotor =
        maxTempMotor == null ? sample.tempMotor : Math.max(maxTempMotor, sample.tempMotor)
    }

    if (previous && previous.capturedAtMs >= lo) {
      const dtMs = sample.capturedAtMs - previous.capturedAtMs
      if (dtMs > 0 && dtMs <= MAX_ENERGY_INTEGRATION_GAP_MS) {
        // Trapezoidal energy over the interval: pack power (V·I) integrated across dt.
        const powerW =
          (previous.batteryVoltage * previous.batteryCurrent +
            sample.batteryVoltage * sample.batteryCurrent) /
          2
        const wh = (powerW * dtMs) / 3_600_000
        if (wh >= 0) batteryUsedWh += wh
        else batteryRegenWh += -wh
      }
    }
    previous = sample
  }

  if (sampleCount === 0) return EMPTY_STATS

  return {
    sampleCount,
    distanceM: sumGpsDistance(gpsSamples, lo, hi),
    maxSpeedKmh,
    avgSpeedKmh: speedSum / sampleCount,
    maxTempMosfet,
    maxTempMotor,
    maxDuty,
    batteryUsedWh,
    batteryRegenWh,
  }
}

/** Distance from GPS deltas inside the range; null when the range carries no GPS distance. */
function sumGpsDistance(gpsSamples: HistoryGpsSample[], lo: number, hi: number): number | null {
  let total = 0
  let counted = false
  for (const gps of gpsSamples) {
    if (gps.capturedAtMs <= lo) continue
    if (gps.capturedAtMs > hi) break
    if (gps.distanceFromPreviousM != null) {
      total += gps.distanceFromPreviousM
      counted = true
    }
  }
  return counted ? total : null
}
