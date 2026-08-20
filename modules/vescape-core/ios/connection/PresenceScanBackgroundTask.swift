import Foundation
import UIKit

/// Finish-current-work guard that carries a Board Presence Scan across the foreground→lock handoff
/// (ADR 0034, ADR 0035, #405).
///
/// The rider opening the app and immediately locking the screen is the case this exists for: iOS
/// suspends the process within moments of backgrounding, which would kill the five-second scan
/// before the radio even reports readiness. `beginBackgroundTask` buys exactly that window.
///
/// This is deliberately NOT a keep-alive and NOT a lifetime anchor:
///
/// - It is ended the moment the scan reaches a terminal phase — match, timeout, **Stop search**, or
///   failure — never held to extend anything.
/// - It creates no Live Activity. The Live Activity is Board-Session-scoped
///   (`RideLiveActivityController`, started only from `beginSession`), so a scan that finds nothing
///   leaves no rider-visible surface behind at all.
/// - Durable background lifetime still comes from the location anchor and CoreBluetooth state
///   restoration (ADR 0034). Restoration ordering is untouched: this task is started by the
///   foreground-entry scan, long after `prepareForLaunch()`.
///
/// @platform-diff Android's peer is `ForegroundWork.PresenceScan` inside `CoreForegroundService`:
/// the foreground service already keeps the process alive across the lock, so its problem is owner
/// arbitration rather than buying time.
internal final class PresenceScanBackgroundTask {
  /// Starts a UIKit background task and returns its identifier; the closure is the expiry handler.
  typealias Begin = (String, @escaping () -> Void) -> UIBackgroundTaskIdentifier
  typealias End = (UIBackgroundTaskIdentifier) -> Void

  private let name: String
  private let begin: Begin
  private let endTask: End
  private let onEvent: (String) -> Void

  /// Live handle, `.invalid` when no scan is being covered. Touched only on the main queue, which is
  /// where both the scan's state changes and the expiration handler are delivered.
  private var taskId: UIBackgroundTaskIdentifier = .invalid

  var isRunning: Bool { taskId != .invalid }

  init(
    name: String = "vesc.presence.scan",
    begin: @escaping Begin = { name, expiry in
      UIApplication.shared.beginBackgroundTask(withName: name, expirationHandler: expiry)
    },
    end: @escaping End = { UIApplication.shared.endBackgroundTask($0) },
    onEvent: @escaping (String) -> Void = { _ in }
  ) {
    self.name = name
    self.begin = begin
    self.endTask = end
    self.onEvent = onEvent
  }

  deinit { end() }

  /// Cover the scan. Re-entrant: a second scan start must not orphan the first identifier.
  func start() {
    guard taskId == .invalid else { return }
    taskId = begin(name) { [weak self] in
      self?.onEvent(ConnectionTraceEvent.backgroundTaskExpired)
      self?.end()
    }
    guard taskId != .invalid else { return }
    onEvent(ConnectionTraceEvent.backgroundTaskStarted)
  }

  /// End the task exactly once. The identifier is cleared before the call, so both the terminal
  /// scan phase and the expiration handler can land here and the second entry is a no-op.
  func end() {
    guard taskId != .invalid else { return }
    let id = taskId
    taskId = .invalid
    endTask(id)
    onEvent(ConnectionTraceEvent.backgroundTaskEnded)
  }
}
