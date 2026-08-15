import ActivityKit
import Foundation

/// Drives the single Board Session Live Activity — the iOS peer of Android's persistent
/// foreground-service notification (`NotificationController`). One activity per session:
/// `start` on session begin, `update` on phase / battery / fault changes, `end` on teardown.
///
/// All work happens natively so the surface survives screen-off and a dead JS runtime, exactly like
/// the Android foreground notification. ActivityKit `update`/`end` are background-safe; the initial
/// `start` must run while the app is foreground, which holds because a session always begins from a
/// user-initiated connect.
///
/// Deployment target is iOS 17, matching the native Clerk SDK used by the app.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notification/NotificationController.kt
/// @platform-diff Android renders a system notification with Disconnect/Connect/Exit actions; the
/// iOS Live Activity exposes Stop ride on iOS 17+, but has no post-stop Connect or Exit action.
final class RideLiveActivityController {
  private var activity: Activity<RideActivityAttributes>?

  /// Whether the OS + user allow Live Activities right now.
  private var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

  /// Begin the session activity. No-op (after ending any stray prior activity) when disabled, so a
  /// single activity is guaranteed. Must be called while the app is foreground.
  func start(state: RideActivityAttributes.ContentState) {
    let staleActivities = knownActivities()
    activity = nil
    end(staleActivities)
    guard enabled else { return }
    let attributes = RideActivityAttributes()
    do {
      activity = try Activity.request(
        attributes: attributes,
        content: .init(state: state, staleDate: nil)
      )
    } catch {
      // Denied authorization or a background start race — drop silently, mirroring Android's
      // best-effort notify. The session itself is unaffected.
      activity = nil
    }
  }

  /// Push a new snapshot to the running activity. Background-safe; a no-op when none is running.
  func update(_ state: RideActivityAttributes.ContentState) {
    guard let activity else { return }
    Task { await activity.update(.init(state: state, staleDate: nil)) }
  }

  /// End and immediately dismiss the activity. Idempotent.
  func end() {
    let activities = knownActivities()
    self.activity = nil
    end(activities)
  }

  private func knownActivities() -> [Activity<RideActivityAttributes>] {
    var activities = Activity<RideActivityAttributes>.activities
    if let activity, !activities.contains(where: { $0.id == activity.id }) {
      activities.append(activity)
    }
    return activities
  }

  private func end(_ activities: [Activity<RideActivityAttributes>]) {
    guard !activities.isEmpty else { return }
    Task {
      for activity in activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
