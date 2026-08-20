package expo.modules.vescapecore.recording

import expo.modules.vescapecore.diagnostics.ConnectionTraceReason
import expo.modules.vescapecore.telemetry.DEFAULT_RIDE_SPLIT_GAP_MINUTES
import expo.modules.vescapecore.telemetry.TelemetryMarkerEntity
import expo.modules.vescapecore.telemetry.TelemetryMinuteBucketEntity
import expo.modules.vescapecore.telemetry.groupProfileSessions
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Ride Summary Notification domain (#410, ADR 0035). Pure: identity, eligibility, battery validity,
 * and notification text. The impure parts — reading the database, posting the notification, and
 * claiming the durable dedup marker — live in [RideSummaryNotifier].
 *
 * @parity /modules/vescape-core/ios/recording/RideSummary.swift
 */
internal data class RideSummary(
  /** Stable Ride History identity: `deviceId:firstSampleAtMs:lastSampleAtMs`. */
  val rideId: String,
  val deviceId: String?,
  val startAtMs: Long,
  val endAtMs: Long,
  val distanceM: Double?,
  val durationMs: Long,
)

/** Skip reason, or `null` when the summary should be sent. Values are [ConnectionTraceReason]. */
internal object RideSummaryPolicy {
  fun skipReason(
    ride: RideSummary?,
    settingEnabled: Boolean,
    permissionGranted: Boolean,
    alreadyNotified: Boolean,
  ): String? = when {
    !settingEnabled -> ConnectionTraceReason.RIDE_SUMMARY_DISABLED
    ride == null -> ConnectionTraceReason.RIDE_NOT_ELIGIBLE
    alreadyNotified -> ConnectionTraceReason.ALREADY_NOTIFIED
    !permissionGranted -> ConnectionTraceReason.PERMISSION_MISSING
    else -> null
  }
}

internal object RideSummaryBuilder {
  /** Mirrors the JS `HistorySession.id` fallback for buckets recorded without a device id. */
  const val UNKNOWN_RIDE_DEVICE_ID = "unknown"

  /**
   * How far behind the ride's end the last persisted Battery SoC Estimate may be and still count.
   * Board Sessions force-persist the estimate on teardown, so anything older than this belongs to
   * an earlier part of the ride (or an earlier ride) and is omitted rather than shown as fact.
   */
  const val BATTERY_MAX_AGE_MS = 5L * 60_000L

  fun rideId(deviceId: String?, startAtMs: Long, endAtMs: Long): String {
    val id = deviceId?.takeIf { it.isNotBlank() } ?: UNKNOWN_RIDE_DEVICE_ID
    return "$id:$startAtMs:$endAtMs"
  }

  /**
   * The most recent ride in [buckets], or `null` when there is none that Ride History would keep.
   * Eligibility is not re-invented here: it reuses [groupProfileSessions] and the same
   * `avgSpeedSampleCount > 0` rule that decides whether a finalized recording shows up as a ride.
   */
  fun latestFinalizedRide(
    buckets: List<TelemetryMinuteBucketEntity>,
    markers: List<TelemetryMarkerEntity>,
    gapMs: Long = DEFAULT_RIDE_SPLIT_GAP_MINUTES * 60_000L,
  ): RideSummary? {
    // The ride that just finalized is the last group, never an earlier one — an ineligible tail
    // means this recording produced no ride, not that some older ride should be announced.
    val session = groupProfileSessions(buckets, markers, gapMs).lastOrNull() ?: return null
    if (session.avgSpeedSampleCount <= 0) return null
    val movingStart = session.movingStartAtMs
    val movingEnd = session.movingEndAtMs
    val durationMs = if (movingStart != null && movingEnd != null) {
      movingEnd - movingStart
    } else {
      session.endAtMs - session.startAtMs
    }
    return RideSummary(
      rideId = rideId(session.deviceId, session.startAtMs, session.endAtMs),
      deviceId = session.deviceId.takeIf { it.isNotBlank() },
      startAtMs = session.startAtMs,
      endAtMs = session.endAtMs,
      distanceM = session.distanceM,
      durationMs = durationMs.coerceAtLeast(0L),
    )
  }

  /**
   * The final valid Battery SoC Estimate for [ride], or `null` when it is missing or stale. A
   * `null` result must omit the battery text entirely — never render 0% or an empty segment.
   */
  fun validBatteryPercent(ride: RideSummary, percent: Double?, atMs: Long?): Int? {
    if (percent == null || atMs == null) return null
    if (percent < 0.0 || percent > 100.0) return null
    if (atMs < ride.startAtMs) return null
    if (atMs - ride.endAtMs > BATTERY_MAX_AGE_MS) return null
    if (ride.endAtMs - atMs > BATTERY_MAX_AGE_MS) return null
    return percent.roundToInt()
  }
}

/**
 * Deep link into that exact Ride History detail. Percent-encodes everything outside `[A-Za-z0-9]`
 * so the `:`-separated recording id survives as one path segment on both platforms.
 *
 * @parity /modules/vescape-core/ios/recording/RideSummary.swift `RideSummaryLink`
 * @parity /src/app/history/ride/[rideId].tsx
 */
internal object RideSummaryLink {
  fun uri(rideId: String): String = "vescape://history/ride/${encode(rideId)}"

  private fun encode(value: String): String = buildString {
    for (byte in value.toByteArray(Charsets.UTF_8)) {
      val char = byte.toInt().toChar()
      if (char.isLetterOrDigit() && char.code < 128) append(char)
      else append("%%%02X".format(byte.toInt() and 0xFF))
    }
  }
}

/**
 * Notification copy. Distance and duration always show; battery is appended only when
 * [RideSummaryBuilder.validBatteryPercent] returned a value.
 *
 * @parity /modules/vescape-core/ios/recording/RideSummary.swift `RideSummaryText`
 */
internal object RideSummaryText {
  fun body(distanceM: Double?, durationMs: Long, batteryPercent: Int?): String {
    val parts = mutableListOf<String>()
    if (distanceM != null) parts += formatDistance(distanceM)
    parts += formatDuration(durationMs)
    if (batteryPercent != null) parts += "$batteryPercent% battery"
    return parts.joinToString(" · ")
  }

  fun formatDistance(distanceM: Double): String {
    val km = distanceM / 1000.0
    return if (km >= 10.0) "${km.roundToLong()} km" else "${(km * 10.0).roundToLong() / 10.0} km"
  }

  fun formatDuration(durationMs: Long): String {
    val totalMinutes = (durationMs.coerceAtLeast(0L) / 60_000L)
    if (totalMinutes < 1L) return "${durationMs.coerceAtLeast(0L) / 1_000L} s"
    val hours = totalMinutes / 60L
    val minutes = totalMinutes % 60L
    return if (hours > 0L) "${hours}h ${minutes}m" else "${minutes} min"
  }
}
