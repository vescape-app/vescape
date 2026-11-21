import ActivityKit
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notification/NotificationController.kt
/// @platform-diff Android's `NotificationController` drives a persistent foreground-service
final class RideLiveActivityController {
  private let staleWindow: TimeInterval = 5
  private let heartbeatInterval: TimeInterval = 2.5

  private var activity: Activity<RideActivityAttributes>?
  private var lastState: RideActivityAttributes.ContentState?
  private var heartbeat: DispatchSourceTimer?
  private var pendingEnd: Task<Void, Never>?

  private var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

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
      activity = nil
    }
  }

  func resume(state: RideActivityAttributes.ContentState) {
    let survivors = Activity<RideActivityAttributes>.activities
    guard let adopted = survivors.first else {
      start(state: state)
      return
    }
    end(Array(survivors.dropFirst()))
    activity = adopted
    update(state)
    startHeartbeat()
  }

  func update(_ state: RideActivityAttributes.ContentState) {
    guard let activity else { return }
    lastState = state
    let content = content(state)
    Task { await activity.update(content) }
  }

  func end() {
    let activities = knownActivities()
    self.activity = nil
    lastState = nil
    stopHeartbeat()
    end(activities)
  }

  @MainActor
  func waitForDismissal() async {
    await pendingEnd?.value
  }

  func reapOrphans() {
    guard activity == nil else { return }
    end(Activity<RideActivityAttributes>.activities)
  }

  private func content(_ state: RideActivityAttributes.ContentState)
    -> ActivityContent<RideActivityAttributes.ContentState>
  {
    .init(state: state, staleDate: Date().addingTimeInterval(staleWindow))
  }

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
    let previousEnd = pendingEnd
    pendingEnd = Task {
      await previousEnd?.value
      for activity in activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
