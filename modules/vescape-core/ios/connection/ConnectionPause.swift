import Foundation

/// One Automatic Connection Pause entry: a Board the rider deliberately stopped, and the absolute
/// moment automatic connection may resume for it (ADR 0035).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ConnectionPause.kt `ConnectionPause`
/// @parity /modules/vescape-core/src/index.ts `ConnectionPauseState`
struct ConnectionPause: Equatable {
  let boardId: String
  /// Absolute deadline. Expiry is by clock comparison, so no cleanup job exists.
  let untilMs: Int64
  /// Rider action that armed it, from `ConnectionTraceReason`.
  let source: String

  var map: [String: Any?] {
    ["boardId": boardId, "until": untilMs, "source": source]
  }
}

/// Pure rules of the board-scoped Automatic Connection Pause map (ADR 0035, #406). This replaces the
/// permanent manual-stop tombstone and the separate Auto Start restart gate: one map, one deadline
/// per Board, shared by Auto Connect and Android Auto Start.
///
/// Rider intent arms a pause; mechanics never do. Mechanical teardown, Board switch cleanup, probe
/// cancellation, Stop search, and scan timeout are deliberately absent from `armingSources`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ConnectionPause.kt `ConnectionPausePolicy`
enum ConnectionPausePolicy {
  /// Legacy values up to 24h stay valid; only the rider-facing stepper recommends less.
  static let maxPauseMinutes = 1440

  /// Cap offered for *new* selections. Stored values above it are preserved, never clamped.
  static let recommendedMaxPauseMinutes = 480

  /// The four rider actions that arm a pause. Everything else is mechanics.
  static let armingSources: Set<String> = [
    ConnectionTraceReason.manualDisconnect,
    ConnectionTraceReason.endRide,
    ConnectionTraceReason.appExit,
    ConnectionTraceReason.taskRemoved,
  ]

  static func arms(_ source: String) -> Bool { armingSources.contains(source) }

  /// Absolute deadline for a pause armed now, or `nil` when the rider configured zero minutes.
  static func deadlineFor(nowMs: Int64, minutes: Int) -> Int64? {
    minutes <= 0 ? nil : nowMs + Int64(minutes) * 60_000
  }

  static func isActive(_ pause: ConnectionPause, nowMs: Int64) -> Bool { pause.untilMs > nowMs }

  /// The still-running pause for `boardId`, or `nil` when it never existed or already expired.
  static func active(
    entries: [String: ConnectionPause],
    boardId: String?,
    nowMs: Int64
  ) -> ConnectionPause? {
    guard let boardId, !boardId.isEmpty, let stored = entries[boardId] else { return nil }
    return isActive(stored, nowMs: nowMs) ? stored : nil
  }

  /// Drop expired entries.
  static func prune(entries: [String: ConnectionPause], nowMs: Int64) -> [String: ConnectionPause] {
    entries.filter { isActive($0.value, nowMs: nowMs) }
  }
}

/// Persistence for the Automatic Connection Pause map. Survives process death and reboot, because
/// the whole point is that force-quitting the app does not re-arm automatic connection.
///
/// Later slices call it by Board id, never by "the selected Board": Android Auto Start (#407)
/// evaluates the *detected* Board, and Switch & Connect (#408) clears the *target* Board.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ConnectionPause.kt `ConnectionPauseStore`
final class ConnectionPauseStore {
  static let storageKey = "vesc_automatic_connection_pause"
  static let shared = ConnectionPauseStore()

  private let defaults: UserDefaults
  private let lock = NSLock()

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  /// Arm a pause for `boardId`. Returns `nil` — and stores nothing — when `source` is not a rider
  /// action, or when the configured duration is zero (the rider opted out of pausing).
  @discardableResult
  func arm(
    boardId: String?,
    source: String,
    minutes: Int,
    workflow: ConnectionWorkflow? = nil,
    nowMs: Int64 = ConnectionTrace.now()
  ) -> ConnectionPause? {
    guard let boardId, !boardId.isEmpty, ConnectionPausePolicy.arms(source) else { return nil }
    guard let until = ConnectionPausePolicy.deadlineFor(nowMs: nowMs, minutes: minutes) else {
      workflow?.event(
        ConnectionTraceEvent.pauseBlocked,
        fields: [
          ConnectionTraceField.boardId: boardId,
          ConnectionTraceField.pauseSource: source,
          ConnectionTraceField.deadlineMs: 0,
        ]
      )
      return nil
    }
    let pause = ConnectionPause(boardId: boardId, untilMs: until, source: source)
    lock.lock()
    var entries = ConnectionPausePolicy.prune(entries: read(), nowMs: nowMs)
    entries[boardId] = pause
    write(entries)
    lock.unlock()
    workflow?.event(
      ConnectionTraceEvent.pauseStarted,
      fields: [
        ConnectionTraceField.boardId: boardId,
        ConnectionTraceField.pauseSource: source,
        ConnectionTraceField.pausedUntil: until,
      ]
    )
    return pause
  }

  /// Explicit Connect, Connect now, and Switch & Connect clear the affected Board's pause.
  func clear(boardId: String?, workflow: ConnectionWorkflow? = nil) {
    guard let boardId, !boardId.isEmpty else { return }
    lock.lock()
    var entries = read()
    guard let existing = entries[boardId] else {
      lock.unlock()
      return
    }
    entries.removeValue(forKey: boardId)
    write(entries)
    lock.unlock()
    workflow?.event(
      ConnectionTraceEvent.pauseCleared,
      fields: [
        ConnectionTraceField.boardId: boardId,
        ConnectionTraceField.pauseSource: existing.source,
        ConnectionTraceField.pausedUntil: existing.untilMs,
      ]
    )
  }

  /// The running pause for `boardId`. Expired entries are dropped here — no cleanup job.
  func active(
    boardId: String?,
    workflow: ConnectionWorkflow? = nil,
    nowMs: Int64 = ConnectionTrace.now()
  ) -> ConnectionPause? {
    guard let boardId, !boardId.isEmpty else { return nil }
    lock.lock()
    let entries = read()
    guard let stored = entries[boardId] else {
      lock.unlock()
      return nil
    }
    if ConnectionPausePolicy.isActive(stored, nowMs: nowMs) {
      lock.unlock()
      return stored
    }
    write(ConnectionPausePolicy.prune(entries: entries, nowMs: nowMs))
    lock.unlock()
    workflow?.event(
      ConnectionTraceEvent.pauseExpired,
      fields: [
        ConnectionTraceField.boardId: boardId,
        ConnectionTraceField.pauseSource: stored.source,
        ConnectionTraceField.pausedUntil: stored.untilMs,
      ]
    )
    return nil
  }

  /// Deadline feeding `PresencePromotionInput.pausedUntilMs`, or `nil` when not paused.
  func pausedUntilMs(
    boardId: String?,
    workflow: ConnectionWorkflow? = nil,
    nowMs: Int64 = ConnectionTrace.now()
  ) -> Int64? {
    active(boardId: boardId, workflow: workflow, nowMs: nowMs)?.untilMs
  }

  func entries() -> [String: ConnectionPause] {
    lock.lock()
    defer { lock.unlock() }
    return read()
  }

  func clearAll() {
    lock.lock()
    defaults.removeObject(forKey: Self.storageKey)
    lock.unlock()
  }

  // MARK: - Storage

  private func read() -> [String: ConnectionPause] {
    guard let raw = defaults.dictionary(forKey: Self.storageKey) else { return [:] }
    var entries: [String: ConnectionPause] = [:]
    for (boardId, value) in raw {
      guard
        let entry = value as? [String: Any],
        let until = (entry["until"] as? NSNumber)?.int64Value, until > 0,
        let source = entry["source"] as? String, !source.isEmpty
      else { continue }
      entries[boardId] = ConnectionPause(boardId: boardId, untilMs: until, source: source)
    }
    return entries
  }

  private func write(_ entries: [String: ConnectionPause]) {
    guard !entries.isEmpty else {
      defaults.removeObject(forKey: Self.storageKey)
      return
    }
    var raw: [String: Any] = [:]
    for (boardId, pause) in entries {
      raw[boardId] = ["until": NSNumber(value: pause.untilMs), "source": pause.source]
    }
    defaults.set(raw, forKey: Self.storageKey)
  }
}
