import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt `REMOTE_TILT_REPEAT_MS`
private let REMOTE_TILT_REPEAT_MS: Int64 = 100

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt `REMOTE_TILT_CANCEL_FULL_RANGE_MS`
internal let REMOTE_TILT_CANCEL_FULL_RANGE_MS: Int64 = 600

/// @parity /modules/vescape-core/src/index.ts `RemoteTiltPhase`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt `RemoteTiltPhase`
internal enum RemoteTiltPhase: String {
  case idle
  case holding
  case decaying
  case locked

  var wireValue: String { rawValue }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt `RemoteTiltDecayProgress`
internal struct RemoteTiltDecayProgress: Equatable {
  let elapsedMs: Int64
  let totalMs: Int64
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt
internal final class RemoteTiltController {
  private enum Stream {
    case hold(value: Int)
    case decay(from: Int, steps: Int)

    func valueAt(_ tick: Int) -> Int {
      switch self {
      case .hold(let value):
        return value
      case .decay(let from, let steps):
        if tick >= steps { return REMOTE_TILT_CENTER }
        let progress = Double(tick) / Double(steps)
        return Int((Double(from) + Double(REMOTE_TILT_CENTER - from) * progress).rounded())
      }
    }

    func finished(_ tick: Int) -> Bool {
      switch self {
      case .hold: return false
      case .decay(_, let steps): return tick >= steps
      }
    }
  }

  private let transport: () -> BoardTransport?
  private let send: (_ payload: [UInt8], _ urgent: Bool) -> Bool
  private let scheduler: Scheduler

  private var stream: Stream?
  private var tick = 0
  private var repeatWork: Cancellable?
  private var locked = false

  init(
    transport: @escaping () -> BoardTransport?,
    send: @escaping (_ payload: [UInt8], _ urgent: Bool) -> Bool,
    scheduler: Scheduler = MainQueueScheduler()
  ) {
    self.transport = transport
    self.send = send
    self.scheduler = scheduler
  }

  var currentValue: Int { stream?.valueAt(tick) ?? REMOTE_TILT_CENTER }

  var isLocked: Bool { locked }

  var phase: RemoteTiltPhase {
    guard let stream else { return .idle }
    if locked { return .locked }
    if case .decay = stream { return .decaying }
    return .holding
  }

  var decayProgress: RemoteTiltDecayProgress? {
    guard case .decay(_, let steps) = stream else { return nil }
    return RemoteTiltDecayProgress(
      elapsedMs: Int64(tick) * REMOTE_TILT_REPEAT_MS,
      totalMs: Int64(steps) * REMOTE_TILT_REPEAT_MS
    )
  }

  @discardableResult
  func hold(_ value: Int) -> Bool {
    let started = start(.hold(value: clampTilt(value)))
    if started { locked = false }
    return started
  }

  @discardableResult
  func lock(_ value: Int) -> Bool {
    let started = start(.hold(value: clampTilt(value)))
    locked = started
    return started
  }

  @discardableResult
  func release(_ value: Int, durationMs: Int64) -> Bool {
    let steps = Int(durationMs / REMOTE_TILT_REPEAT_MS)
    if steps <= 0 { return stop() }
    let started = start(.decay(from: clampTilt(value), steps: steps))
    if started { locked = false }
    return started
  }

  @discardableResult
  func cancel() -> Bool {
    let value = currentValue
    let distance = abs(value - REMOTE_TILT_CENTER)
    if distance == 0 { return stop() }
    let durationMs =
      Int64(distance) * REMOTE_TILT_CANCEL_FULL_RANGE_MS / Int64(255 - REMOTE_TILT_CENTER)
    return release(value, durationMs: durationMs)
  }

  @discardableResult
  func stop() -> Bool {
    let wasActive = stream != nil
    clear()

    if let transport = transport() {
      _ = send(buildRemoteTiltCommand(transport: transport, value: REMOTE_TILT_CENTER), true)
    }
    return wasActive
  }

  private func clampTilt(_ value: Int) -> Int { min(max(value, 0), 255) }

  private func start(_ next: Stream) -> Bool {
    guard let transport = transport() else { return false }

    let alreadyStreaming = repeatWork != nil
    stream = next
    tick = 0
    if alreadyStreaming { return true }

    let sent = send(buildRemoteTiltCommand(transport: transport, value: next.valueAt(0)), false)
    scheduleRepeat()
    return sent
  }

  private func scheduleRepeat() {
    repeatWork = scheduler.postDelayed(REMOTE_TILT_REPEAT_MS) { [weak self] in
      guard let self else { return }
      guard let stream = self.stream, let transport = self.transport() else {
        self.clear()
        return
      }
      self.tick += 1
      _ = self.send(
        buildRemoteTiltCommand(transport: transport, value: stream.valueAt(self.tick)), false)
      if stream.finished(self.tick) {
        self.clear()
        return
      }
      self.scheduleRepeat()
    }
  }

  private func clear() {
    stream = nil
    tick = 0
    locked = false
    repeatWork?.cancel()
    repeatWork = nil
  }
}
