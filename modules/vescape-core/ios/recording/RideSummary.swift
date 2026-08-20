import Foundation
import GRDB

/// Ride Summary Notification domain (#410, ADR 0035). Pure: identity, eligibility, battery
/// validity, and notification text. The impure parts — reading the database, posting the
/// notification, and claiming the durable dedup marker — live in `RideSummaryController`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/RideSummary.kt
internal struct RideSummary: Equatable {
  /// Stable Ride History identity: `deviceId:firstSampleAtMs:lastSampleAtMs`.
  let rideId: String
  let deviceId: String?
  let startAtMs: Int64
  let endAtMs: Int64
  let distanceM: Double?
  let durationMs: Int64
}

/// Skip reason, or `nil` when the summary should be sent. Values are `ConnectionTraceReason`.
internal enum RideSummaryPolicy {
  static func skipReason(
    ride: RideSummary?,
    settingEnabled: Bool,
    permissionGranted: Bool,
    alreadyNotified: Bool
  ) -> String? {
    if !settingEnabled { return ConnectionTraceReason.rideSummaryDisabled }
    if ride == nil { return ConnectionTraceReason.rideNotEligible }
    if alreadyNotified { return ConnectionTraceReason.alreadyNotified }
    if !permissionGranted { return ConnectionTraceReason.permissionMissing }
    return nil
  }
}

internal enum RideSummaryBuilder {
  /// Mirrors the JS `HistorySession.id` fallback for buckets recorded without a device id.
  static let unknownRideDeviceId = "unknown"

  /// How far behind the ride's end the last persisted Battery SoC Estimate may be and still count.
  /// Board Sessions force-persist the estimate on teardown, so anything older than this belongs to
  /// an earlier part of the ride (or an earlier ride) and is omitted rather than shown as fact.
  static let batteryMaxAgeMs: Int64 = 5 * 60_000

  static func rideId(deviceId: String?, startAtMs: Int64, endAtMs: Int64) -> String {
    let id = (deviceId?.isEmpty == false) ? deviceId! : unknownRideDeviceId
    return "\(id):\(startAtMs):\(endAtMs)"
  }

  /// The ride that just finalized, or `nil` when it is not one Ride History would keep.
  /// Eligibility is not re-invented here: it reuses `groupProfileSessions` and the same
  /// `avgSpeedSampleCount > 0` rule that decides whether a finalized recording shows up as a ride.
  static func latestFinalizedRide(
    buckets: [Row],
    markers: [Row],
    gapMs: Int64 = DEFAULT_RIDE_SPLIT_GAP_MS
  ) -> RideSummary? {
    // The ride that just finalized is the last group, never an earlier one — an ineligible tail
    // means this recording produced no ride, not that some older ride should be announced.
    guard let session = groupProfileSessions(buckets: buckets, markers: markers, gapMs: gapMs).last
    else { return nil }
    guard session.avgSpeedSampleCount > 0 else { return nil }
    let durationMs: Int64
    if let start = session.movingStartAtMs, let end = session.movingEndAtMs {
      durationMs = end - start
    } else {
      durationMs = session.endAtMs - session.startAtMs
    }
    return RideSummary(
      rideId: rideId(
        deviceId: session.deviceId,
        startAtMs: session.startAtMs,
        endAtMs: session.endAtMs
      ),
      deviceId: session.deviceId.isEmpty ? nil : session.deviceId,
      startAtMs: session.startAtMs,
      endAtMs: session.endAtMs,
      distanceM: session.distanceM,
      durationMs: max(0, durationMs)
    )
  }

  /// The final valid Battery SoC Estimate for `ride`, or `nil` when it is missing or stale. A `nil`
  /// result must omit the battery text entirely — never render 0% or an empty segment.
  static func validBatteryPercent(ride: RideSummary, percent: Double?, atMs: Int64?) -> Int? {
    guard let percent, let atMs else { return nil }
    guard percent >= 0, percent <= 100 else { return nil }
    guard atMs >= ride.startAtMs else { return nil }
    guard atMs - ride.endAtMs <= batteryMaxAgeMs else { return nil }
    guard ride.endAtMs - atMs <= batteryMaxAgeMs else { return nil }
    return Int(percent.rounded())
  }
}

/// Deep link into that exact Ride History detail. Percent-encodes everything outside `[A-Za-z0-9]`
/// so the `:`-separated recording id survives as one path segment on both platforms.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/RideSummary.kt `RideSummaryLink`
/// @parity /src/app/history/ride/[rideId].tsx
internal enum RideSummaryLink {
  static func uri(rideId: String) -> String {
    let encoded = rideId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? rideId
    return "vescape://history/ride/\(encoded)"
  }
}

/// Notification copy. Distance and duration always show; battery is appended only when
/// `RideSummaryBuilder.validBatteryPercent` returned a value.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/RideSummary.kt `RideSummaryText`
internal enum RideSummaryText {
  static func body(distanceM: Double?, durationMs: Int64, batteryPercent: Int?) -> String {
    var parts: [String] = []
    if let distanceM { parts.append(formatDistance(distanceM)) }
    parts.append(formatDuration(durationMs))
    if let batteryPercent { parts.append("\(batteryPercent)% battery") }
    return parts.joined(separator: " · ")
  }

  static func formatDistance(_ distanceM: Double) -> String {
    let km = distanceM / 1000.0
    if km >= 10.0 { return "\(Int64(km.rounded())) km" }
    return "\(Double(Int64((km * 10.0).rounded())) / 10.0) km"
  }

  static func formatDuration(_ durationMs: Int64) -> String {
    let clamped = max(0, durationMs)
    let totalMinutes = clamped / 60_000
    if totalMinutes < 1 { return "\(clamped / 1_000) s" }
    let hours = totalMinutes / 60
    let minutes = totalMinutes % 60
    return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes) min"
  }
}
