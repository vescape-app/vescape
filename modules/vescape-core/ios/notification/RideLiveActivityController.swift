import ActivityKit
import Foundation

/// Drives the single Board Session Live Activity — a **render-only** status surface. One activity
/// per session: `start` on session begin, `update` on phase / battery / fault changes, `end` on
/// teardown.
///
/// All work happens natively so the surface survives screen-off and a dead JS runtime. ActivityKit
/// `update`/`end` are background-safe; the initial `start` must run while the app is foreground,
/// which holds because a session always begins from a user-initiated connect.
///
/// Honesty about process death (ADR 0034): the app cannot call `end()` once it is killed, and
/// `activityd` keeps rendering the last snapshot for hours. Two layers fix that — every content push
/// carries a short `staleDate` so the widget self-labels as stale with zero running code, and
/// `reapOrphans()` removes activities left behind by a dead process at launch.
///
/// Deployment target is iOS 17, matching the native Clerk SDK used by the app.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notification/NotificationController.kt
/// @platform-diff Android's `NotificationController` drives a persistent foreground-service
/// notification, which is both the process keep-alive and the status UI. The iOS Live Activity is
/// render-only: it grants the process no lifetime at all (the anchor is the location manager, ADR
/// 0034), so it must self-label death via `staleDate` instead. Action parity also differs: Android
/// offers Disconnect/Connect/Exit, iOS only Stop ride.
final class RideLiveActivityController {
  /// How long a pushed snapshot stays believable. Updates are change-driven (phase, stepped battery
  /// percent, fault edges) with no guaranteed floor — a parked board can hold the same rounded
  /// voltage for minutes — so the controller pushes its own heartbeat below rather than letting a
  /// quiet-but-alive ride flicker into the stale state. The window is 2× the heartbeat: a ghost
  /// self-labels within ~5 s, while a single delayed tick still lands inside the window.
  private let staleWindow: TimeInterval = 5
  /// Liveness beat: re-push the last snapshot while nothing else changes. Local `update()` calls are
  /// not rate-limited by ActivityKit (the session path already pushes up to 1 Hz), so this is cheap.
  private let heartbeatInterval: TimeInterval = 2.5

  private var activity: Activity<RideActivityAttributes>?
  private var lastState: RideActivityAttributes.ContentState?
  private var heartbeat: DispatchSourceTimer?

  /// Whether the OS + user allow Live Activities right now.
  private var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

  /// Begin the session activity. No-op (after ending any stray prior activity) when disabled, so a
  /// single activity is guaranteed. Must be called while the app is foreground.
  func start(state: RideActivityAttributes.ContentState) {
    let staleActivities = knownActivities()
    activity = nil
    lastState = nil
    stopHeartbeat()
    end(staleActivities)
    guard enabled else { return }
    let attributes = RideActivityAttributes()
    do {
      activity = try Activity.request(attributes: attributes, content: content(state))
      lastState = state
      startHeartbeat()
    } catch {
      // Denied authorization or a background start race — drop silently, mirroring Android's
      // best-effort notify. The session itself is unaffected.
      activity = nil
    }
  }

  /// Re-take ownership of the activity a killed process left behind (ADR 0034 headless resume).
  ///
  /// `Activity.request` needs the foreground, so a background relaunch cannot mint a new activity:
  /// the surviving one is adopted and updated instead (both background-safe). Falls back to `start`
  /// when nothing survived — harmless in the background, where it simply fails to request and the
  /// session runs without a surface until the app is next opened.
  func resume(state: RideActivityAttributes.ContentState) {
    let survivors = Activity<RideActivityAttributes>.activities
    guard let adopted = survivors.first else {
      start(state: state)
      return
    }
    // One activity per session: anything beyond the adopted one is a duplicate ghost.
    end(Array(survivors.dropFirst()))
    activity = adopted
    update(state)
    startHeartbeat()
  }

  /// Push a new snapshot to the running activity. Background-safe; a no-op when none is running.
  func update(_ state: RideActivityAttributes.ContentState) {
    guard let activity else { return }
    lastState = state
    let content = content(state)
    Task { await activity.update(content) }
  }

  /// End and immediately dismiss the activity. Idempotent.
  func end() {
    let activities = knownActivities()
    self.activity = nil
    lastState = nil
    stopHeartbeat()
    end(activities)
  }

  /// Remove activities this process does not own — the ghosts a previous, killed process left
  /// behind. Only safe to call when nothing wants to reclaim an existing activity; the caller owns
  /// that decision (see `BoardSessionController.reapOrphanLiveActivities`).
  func reapOrphans() {
    guard activity == nil else { return }
    end(Activity<RideActivityAttributes>.activities)
  }

  private func content(_ state: RideActivityAttributes.ContentState)
    -> ActivityContent<RideActivityAttributes.ContentState>
  {
    .init(state: state, staleDate: Date().addingTimeInterval(staleWindow))
  }

  /// Re-push the last snapshot on a fixed beat so `staleDate` measures process liveness rather than
  /// telemetry churn. A killed or suspended process stops beating and the widget goes stale.
  private func startHeartbeat() {
    stopHeartbeat()
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + heartbeatInterval, repeating: heartbeatInterval)
    timer.setEventHandler { [weak self] in
      guard let self, let activity = self.activity, let state = self.lastState else { return }
      let content = self.content(state)
      Task { await activity.update(content) }
    }
    timer.resume()
    heartbeat = timer
  }

  private func stopHeartbeat() {
    heartbeat?.cancel()
    heartbeat = nil
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
