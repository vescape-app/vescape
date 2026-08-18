import Foundation
import UIKit

/// Finish-current-work guard around the Ride Recording telemetry flush on the foreground→background
/// handoff and on app termination (ADR 0034).
///
/// `TelemetryRepository` batches recorded frames in memory and only writes once ~25 are pending, so
/// a suspension (or jetsam) right after backgrounding drops the tail. `beginBackgroundTask` buys the
/// few milliseconds the blocking flush needs before iOS suspends the process.
///
/// This is explicitly NOT a keep-alive: the task is ended as soon as the flush returns, never held
/// to extend the session. Background lifetime comes from the location anchor (ADR 0034), not here.
///
/// @platform-diff Android has no peer: `CoreForegroundService` keeps the process alive across the
/// background transition, so its telemetry store flushes on its own schedule.
internal final class BackgroundFlushGuard {
  private let notificationCenter: NotificationCenter
  private let flush: (String) -> Void
  private var observers: [NSObjectProtocol] = []
  /// Live background-task handle, `.invalid` when no flush is in flight. Only touched on the main
  /// queue, which is where both lifecycle notifications and the expiration handler are delivered.
  private var taskId: UIBackgroundTaskIdentifier = .invalid

  init(notificationCenter: NotificationCenter = .default, flush: @escaping (String) -> Void) {
    self.notificationCenter = notificationCenter
    self.flush = flush
    observers = [
      (UIApplication.didEnterBackgroundNotification, "background"),
      (UIApplication.willTerminateNotification, "terminate"),
    ].map { name, reason in
      notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.run(reason: reason)
      }
    }
  }

  deinit {
    observers.forEach { notificationCenter.removeObserver($0) }
    endTask()
  }

  private func run(reason: String) {
    // Re-entrant guard: a terminate arriving on top of a background transition must not orphan the
    // first task identifier.
    guard taskId == .invalid else { return }
    taskId = UIApplication.shared.beginBackgroundTask(withName: "vesc.recording.flush") {
      [weak self] in self?.endTask()
    }
    flush(reason)
    endTask()
  }

  /// Ends the task exactly once — both the success path and the expiration handler land here, and
  /// the identifier is cleared before the call so a second entry is a no-op.
  private func endTask() {
    guard taskId != .invalid else { return }
    let id = taskId
    taskId = .invalid
    UIApplication.shared.endBackgroundTask(id)
  }
}
