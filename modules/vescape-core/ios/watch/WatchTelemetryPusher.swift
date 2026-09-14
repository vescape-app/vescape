import Foundation
import WatchConnectivity

/// Phone -> watchOS Mirror transport (ADR-0019). Fire-and-forget `sendMessageData` of an
/// already-encoded Watch Frame to the paired watch. Lives native (in vescape-core, beside the
/// telemetry truth) so it keeps pushing while JS is backgrounded mid-ride. The frame is built and
/// throttled by `WatchTick`; this only ships bytes.
///
/// Delivery problems record one diagnostic event per issue streak (not per frame — frames flow at
/// ~4 Hz), plus one recovery event, so silent failures are readable from the in-app event log in
/// the field. Counterpart lifecycle transitions (activation, install, reachability) are recorded on
/// change for the same reason: wrist-down and locked-phone behavior is the open question this slice
/// exists to measure, and it cannot be measured from a screenshot.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTelemetryPusher.kt
/// @platform-diff Android looks up target nodes through a blocking Play-services IPC and caches
/// them on a TTL. `WCSession` publishes `isReachable` as a property with no per-send lookup, so
/// there is nothing to cache and no node set to invalidate.
final class WatchTelemetryPusher: NSObject, WCSessionDelegate {
  private let record: (String, [String: Any?]) -> Void
  private var session: WCSession?
  private var activeIssue: String?
  private var lastReachable: Bool?

  init(record: @escaping (String, [String: Any?]) -> Void) {
    self.record = record
    super.init()
  }

  /// Whether a frame sent right now has somewhere to go. The capability gate `WatchTick` checks
  /// before it spends anything on building one.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMirrorPresence.kt
  var canPush: Bool {
    guard let session, session.activationState == .activated else { return false }
    return session.isPaired && session.isWatchAppInstalled && session.isReachable
  }

  /// Activate the counterpart session. Idempotent; a no-op on hardware without a Watch counterpart.
  ///
  /// There is no matching stop: `WCSession` is owned by the system and lives as long as the process,
  /// so the phone side has nothing to tear down. Gating happens in `canPush`, not in activation.
  func start() {
    guard WCSession.isSupported() else {
      reportIssue("watch_session_unsupported")
      return
    }
    guard session == nil else { return }
    let session = WCSession.default
    session.delegate = self
    self.session = session
    session.activate()
  }

  func pushFrame(_ frame: Data) {
    guard let session, canPush else { return }
    session.sendMessageData(
      frame,
      replyHandler: nil,
      errorHandler: { [weak self] error in
        self?.reportIssue("watch_frame_send_failed", ["error": error.localizedDescription])
      }
    )
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    record(
      "watch_session_activated",
      [
        "state": activationState.rawValue,
        "paired": session.isPaired,
        "app_installed": session.isWatchAppInstalled,
        "reachable": session.isReachable,
        "error": error?.localizedDescription,
      ]
    )
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    guard self.session != nil else { return }
    let reachable = session.isReachable
    guard reachable != lastReachable else { return }
    lastReachable = reachable
    record("watch_reachability_changed", ["reachable": reachable])
    // Regained reachability is the recovery signal. `sendMessageData` without a reply handler has
    // no success callback, so a send that simply does not fail is not an observable event — this
    // is, and it is the one the field log needs to close out a failure streak.
    if reachable { reportRecovered() }
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    guard self.session != nil else { return }
    record(
      "watch_state_changed",
      ["paired": session.isPaired, "app_installed": session.isWatchAppInstalled]
    )
  }

  /// Required on iOS: the system tears the session down when the rider switches paired watches, and
  /// expects it reactivated against the new one.
  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    guard self.session != nil else { return }
    session.activate()
  }

  // MARK: - Diagnostics

  private func reportIssue(_ name: String, _ properties: [String: Any?] = [:]) {
    if activeIssue != name {
      record(name, properties)
    }
    activeIssue = name
  }

  private func reportRecovered() {
    guard let resolved = activeIssue else { return }
    activeIssue = nil
    record("watch_frame_send_recovered", ["after": resolved])
  }
}
