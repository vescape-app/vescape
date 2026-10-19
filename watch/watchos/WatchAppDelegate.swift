import WatchKit
import WatchConnectivity

/// Register the receiver before a scene appears. Connectivity launches can be entirely background.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
  private var tasks: [WKWatchConnectivityRefreshBackgroundTask] = []
  private var pendingObservation: NSKeyValueObservation?

  func applicationDidFinishLaunching() {
#if DEBUG && targetEnvironment(simulator)
    if BatteryComplicationGallery.requested != nil || FrameReplayer.requestedFixture != nil { return }
#endif
    let session = WCSession.default
    pendingObservation = session.observe(\.hasContentPending, options: [.new]) { [weak self] _, _ in
      DispatchQueue.main.async { self?.completeDrainedTasks() }
    }
    PhoneLink.shared.onActivation = { [weak self] in self?.completeDrainedTasks() }
    PhoneLink.shared.activate()
  }

  func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
    for task in backgroundTasks {
      if let task = task as? WKWatchConnectivityRefreshBackgroundTask {
        tasks.append(task)
      } else {
        task.setTaskCompletedWithSnapshot(false)
      }
    }
    completeDrainedTasks()
  }

  private func completeDrainedTasks() {
    let session = WCSession.default
    guard session.activationState == .activated, !session.hasContentPending else { return }
    PhoneLink.shared.refreshLastBatteryContext()
    for task in tasks { task.setTaskCompletedWithSnapshot(false) }
    tasks.removeAll()
  }
}
