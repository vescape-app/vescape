import Foundation
import os

/// Process-wide owner of the Ride Notice table. Process-level rather than on the Board Session, so a
/// notice has one owner for every surface (JS card, watch, ride notification). All mutations run on
/// main; expiry is scheduled for the earliest `expiresAt`.
///
/// Sources call `post` / `clear`; surfaces call `dismiss` and observe the ordered list with
/// `addListener`, which fires only when the visible list changes.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notices/RideNotices.kt `RideNotices`
final class RideNotices {
  static let shared = RideNotices()

  private static let log = Logger(subsystem: "VescapeCore", category: "RideNotices")

  private let engine = RideNoticeEngine()
  private var listeners: [UUID: ([RideNotice]) -> Void] = [:]
  private var expiryWork: DispatchWorkItem?

  private let currentLock = NSLock()
  private var currentStorage: [RideNotice] = []

  /// The visible notices, most urgent first. Safe to read from any thread.
  var current: [RideNotice] {
    currentLock.lock()
    defer { currentLock.unlock() }
    return currentStorage
  }

  private init() {}

  func post(key: String, content: RideNoticeContent, revision: String) {
    mutate {
      switch $0.post(key: key, content: content, revision: revision, nowMs: Self.nowMs()) {
      case .changed: return true
      case .unchanged: return false
      case .dropped:
        Self.log.warning("Dropped Ride Notice \(key, privacy: .public): all \(RideNoticeEngine.maxId) ids are active")
        return false
      }
    }
  }

  func clear(key: String) {
    mutate { $0.clear(key: key) }
  }

  func dismiss(id: Int) {
    mutate { $0.dismiss(id: id) }
  }

  /// Drop anything already past `expiresAt`. The expiry timer is suspended while the app is in the
  /// background, so a surface coming back calls this before trusting `current`.
  func expireNow() {
    mutate { $0.tick(nowMs: Self.nowMs()) }
  }

  /// Listen for the ordered visible list, called on main. Returns the unsubscribe.
  @discardableResult
  func addListener(_ listener: @escaping ([RideNotice]) -> Void) -> () -> Void {
    let token = UUID()
    onMain { self.listeners[token] = listener }
    return { [weak self] in self?.onMain { self?.listeners[token] = nil } }
  }

  private func mutate(_ block: @escaping (RideNoticeEngine) -> Bool) {
    onMain {
      let changed = block(self.engine)
      self.scheduleExpiry()
      guard changed else { return }
      let notices = self.engine.active
      self.currentLock.lock()
      self.currentStorage = notices
      self.currentLock.unlock()
      self.listeners.values.forEach { $0(notices) }
    }
  }

  private func scheduleExpiry() {
    expiryWork?.cancel()
    expiryWork = nil
    guard let next = engine.nextExpiryAt() else { return }
    let work = DispatchWorkItem { [weak self] in self?.expireNow() }
    expiryWork = work
    let delay = max(0, Double(next - Self.nowMs()) / 1000)
    DispatchQueue.main.asyncAfter(wallDeadline: .now() + delay, execute: work)
  }

  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
  }

  private static func nowMs() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
  }
}
