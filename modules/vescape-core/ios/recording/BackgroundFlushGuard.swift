import Foundation
import UIKit

/// @platform-diff Android has no peer: `CoreForegroundService` keeps the process alive across the
internal final class BackgroundFlushGuard {
  private let notificationCenter: NotificationCenter
  private let flush: (String) -> Void
  private var observers: [NSObjectProtocol] = []
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
    guard taskId == .invalid else { return }
    taskId = UIApplication.shared.beginBackgroundTask(withName: "vesc.recording.flush") {
      [weak self] in self?.endTask()
    }
    flush(reason)
    endTask()
  }

  private func endTask() {
    guard taskId != .invalid else { return }
    let id = taskId
    taskId = .invalid
    UIApplication.shared.endBackgroundTask(id)
  }
}
