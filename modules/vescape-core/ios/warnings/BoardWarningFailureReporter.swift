import Foundation

/// Reports Board Warning DB failures to diagnostics, throttled to once per (site, session).
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `reportWarningFailure`
final class BoardWarningFailureReporter {
  static let shared = BoardWarningFailureReporter()

  private let record: (String, [String: Any?]) -> Void
  private let lock = NSLock()
  private var reportedSites = Set<String>()

  init(
    record: @escaping (String, [String: Any?]) -> Void = { name, props in
      DiagnosticsRecorder.shared.record(eventName: name, properties: props)
    }
  ) {
    self.record = record
  }

  func beginSession() {
    lock.lock()
    reportedSites.removeAll(keepingCapacity: true)
    lock.unlock()
  }

  func report(site: String, error: Error) {
    lock.lock()
    let isFirst = reportedSites.insert(site).inserted
    lock.unlock()
    guard isFirst else { return }
    record(
      "board_warning_failure",
      [
        "site": site,
        "message": error.localizedDescription,
        "error_type": String(describing: type(of: error)),
      ]
    )
  }
}
