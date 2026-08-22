import Foundation
import UserNotifications

/// The one notification backup raises: it has stopped, and only the Rider can restart it.
///
/// Deliberately narrow — ordinary retries, offline stretches and a metered connection say nothing.
/// A `SyncPauseReason` does not resolve on its own, and a backup that has silently stopped for weeks
/// is the failure this feature can least afford, so each reason gets one actionable notification and
/// is cleared again the moment the pause lifts.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncNotifier.kt
final class SyncNotifier {
  static let shared = SyncNotifier()

  private static let identifier = "vescape.backupPaused"

  private init() {}

  /// Show the notification for `reason`, replacing any previous one, or clear it when nil.
  func update(_ reason: SyncPauseReason?) {
    let center = UNUserNotificationCenter.current()
    guard let reason else {
      center.removePendingNotificationRequests(withIdentifiers: [Self.identifier])
      center.removeDeliveredNotifications(withIdentifiers: [Self.identifier])
      return
    }
    let content = UNMutableNotificationContent()
    content.title = "Backup paused"
    content.body = Self.text(reason)
    content.sound = .default
    center.add(
      UNNotificationRequest(identifier: Self.identifier, content: content, trigger: nil)
    )
  }

  /// What the Rider has to do, in the same three shapes the account widget names.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncNotifier.kt `text`
  static func text(_ reason: SyncPauseReason) -> String {
    switch reason {
    case .authentication: return "Sign in again to keep backing up your rides."
    case .protocolFailure: return "Update Vescape to keep backing up your rides."
    case .rowTooLarge: return "Backup hit an error. Check the event log in settings."
    }
  }
}
