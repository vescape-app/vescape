import Foundation
import GRDB
import UIKit
import UserNotifications

/// One silent Ride Summary Notification per finalized, Ride-History-eligible Ride Recording (#410).
///
/// Deduplication is durable, not in memory: `RideSummaryStore` is keyed by the stable Ride History
/// recording id. The row is *claimed* (INSERT OR IGNORE, inside the database's own transaction)
/// **before** the notification is scheduled, and released again only when scheduling failed. A
/// crash or CoreBluetooth restoration between claim and schedule therefore loses that one
/// notification rather than duplicating it — the ordering the issue asks for, resolved in the safe
/// direction.
///
/// Notification permission is only ever *read* here. Ride completion never prompts; a denied or
/// undetermined status is a silent, traced skip.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notification/RideSummaryNotifier.kt
internal enum RideSummaryController {
  /// How far back to look for the ride that just finalized.
  private static let lookbackMs: Int64 = 24 * 60 * 60 * 1000

  private static let store = RideSummaryStore.shared

  /// Called on every Ride Recording finalization — including repeated callbacks for the same ride,
  /// which the durable claim collapses to one notification.
  static func onRecordingFinalized(boardId: String?, nowMs: Int64) {
    let workflow = ConnectionTrace.start(
      origin: ConnectionTraceOrigin.rideFinalized,
      owner: ConnectionTraceOwner.none,
      fields: [ConnectionTraceField.boardId: boardId]
    )

    let settings = AppDataRepository.shared.getSettings()
    let settingEnabled = settings["rideSummaryNotificationsEnabled"] as? Bool ?? true
    let gapMinutes = (settings["rideSplitGapMinutes"] as? Int) ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES
    let gapMs = Int64(max(1, gapMinutes)) * 60_000
    let ride = latestRide(nowMs: nowMs, gapMs: gapMs)

    UNUserNotificationCenter.current().getNotificationSettings { notificationSettings in
      let permissionGranted = allowsDelivery(notificationSettings.authorizationStatus)
      let alreadyNotified = ride.map { store.wasNotified(rideId: $0.rideId) } ?? false

      workflow.event(
        ConnectionTraceEvent.rideSummaryPrepared,
        fields: [
          ConnectionTraceField.rideId: ride?.rideId,
          ConnectionTraceField.permissionGranted: permissionGranted,
        ]
      )

      let skip = RideSummaryPolicy.skipReason(
        ride: ride,
        settingEnabled: settingEnabled,
        permissionGranted: permissionGranted,
        alreadyNotified: alreadyNotified
      )
      guard skip == nil, let ride else {
        let reason = skip ?? ConnectionTraceReason.rideNotEligible
        workflow.event(
          ConnectionTraceEvent.rideSummarySkipped,
          fields: [ConnectionTraceField.rideId: ride?.rideId, ConnectionTraceField.reason: reason]
        )
        workflow.finish(decision: ConnectionTraceDecision.skipped, reason: reason)
        return
      }

      // Claim first: losing the race here means another finalize callback already owns this ride.
      guard store.claim(rideId: ride.rideId, nowMs: nowMs) else {
        workflow.event(
          ConnectionTraceEvent.rideSummarySkipped,
          fields: [
            ConnectionTraceField.rideId: ride.rideId,
            ConnectionTraceField.reason: ConnectionTraceReason.alreadyNotified,
          ]
        )
        workflow.finish(
          decision: ConnectionTraceDecision.skipped,
          reason: ConnectionTraceReason.alreadyNotified
        )
        return
      }

      RideSummaryNotificationDelegate.install()
      let percent = batteryPercent(boardId: boardId, ride: ride)
      UNUserNotificationCenter.current().add(request(for: ride, batteryPercent: percent)) { error in
        if let error {
          // Nothing was delivered — give the claim back rather than silently burning this ride's
          // one summary.
          store.release(rideId: ride.rideId)
          workflow.finish(
            decision: ConnectionTraceDecision.failed,
            reason: ConnectionTraceReason.platformError,
            fields: [ConnectionTraceField.platformErrorDomain: (error as NSError).domain]
          )
          return
        }
        workflow.event(
          ConnectionTraceEvent.rideSummaryNotified,
          fields: [ConnectionTraceField.rideId: ride.rideId]
        )
        workflow.finish(
          decision: ConnectionTraceDecision.completed,
          reason: ConnectionTraceReason.endRide
        )
      }
    }
  }

  private static func latestRide(nowMs: Int64, gapMs: Int64) -> RideSummary? {
    guard let pool = TelemetryDatabase.pool else { return nil }
    let buckets = (try? pool.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM telemetry_minute_buckets
          WHERE bucket_start_ms >= ?
          ORDER BY bucket_start_ms ASC
          """,
        arguments: [nowMs - lookbackMs]
      )
    }) ?? []
    guard !buckets.isEmpty else { return nil }
    let fromMs = (buckets.map { $0["first_sample_at_ms"] as Int64 }.min() ?? 0) - gapMs
    let toMs = (buckets.map { $0["last_sample_at_ms"] as Int64 }.max() ?? 0) + TELEMETRY_BUCKET_SIZE_MS
    let markers = (try? pool.read { db in
      try Row.fetchAll(
        db,
        sql: "SELECT * FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? ORDER BY occurred_at_ms ASC",
        arguments: [fromMs, toMs]
      )
    }) ?? []
    return RideSummaryBuilder.latestFinalizedRide(buckets: buckets, markers: markers, gapMs: gapMs)
  }

  /// Final valid Battery SoC Estimate, or nil so the battery text is omitted entirely.
  private static func batteryPercent(boardId: String?, ride: RideSummary) -> Int? {
    guard let boardId,
      let board = AppDataRepository.shared.getBoard(boardId),
      let last = (board["lastBattery"] ?? nil) as? [String: Any]
    else { return nil }
    let percent = (last["percent"] as? NSNumber)?.doubleValue
    let atMs = (last["at"] as? NSNumber)?.int64Value
    return RideSummaryBuilder.validBatteryPercent(ride: ride, percent: percent, atMs: atMs)
  }

  private static func request(for ride: RideSummary, batteryPercent: Int?) -> UNNotificationRequest {
    let content = UNMutableNotificationContent()
    content.title = "Ride recorded"
    content.body = RideSummaryText.body(
      distanceM: ride.distanceM,
      durationMs: ride.durationMs,
      batteryPercent: batteryPercent
    )
    // Silent by contract: no sound, and passive so it never interrupts.
    content.sound = nil
    content.interruptionLevel = .passive
    content.userInfo = [RideSummaryNotificationDelegate.urlKey: RideSummaryLink.uri(rideId: ride.rideId)]
    return UNNotificationRequest(
      identifier: "vescape.rideSummary.\(ride.rideId)",
      content: content,
      trigger: nil
    )
  }

  private static func allowsDelivery(_ status: UNAuthorizationStatus) -> Bool {
    switch status {
    case .authorized, .provisional, .ephemeral: return true
    case .notDetermined, .denied: return false
    @unknown default: return false
    }
  }
}

/// Turns a ride-summary tap into the app's own deep link. Chains to whatever delegate was already
/// installed so this never takes the notification centre away from another feature.
internal final class RideSummaryNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  static let urlKey = "vescapeUrl"
  private static var installed: RideSummaryNotificationDelegate?
  private weak var previous: UNUserNotificationCenterDelegate?

  static func install() {
    guard installed == nil else { return }
    let center = UNUserNotificationCenter.current()
    let delegate = RideSummaryNotificationDelegate()
    delegate.previous = center.delegate
    center.delegate = delegate
    installed = delegate
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let userInfo = response.notification.request.content.userInfo
    if let raw = userInfo[Self.urlKey] as? String, let url = URL(string: raw) {
      DispatchQueue.main.async { UIApplication.shared.open(url) }
      completionHandler()
      return
    }
    guard let previous else {
      completionHandler()
      return
    }
    previous.userNotificationCenter?(
      center,
      didReceive: response,
      withCompletionHandler: completionHandler
    ) ?? completionHandler()
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    guard let previous, previous.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) else {
      completionHandler([.banner, .list])
      return
    }
    previous.userNotificationCenter?(
      center,
      willPresent: notification,
      withCompletionHandler: completionHandler
    )
  }
}
