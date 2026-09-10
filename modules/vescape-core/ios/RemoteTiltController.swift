import Foundation

/// Remote input lapses in firmware after ~1s of silence, so the held tilt only has to be refreshed
/// inside that window. It used to tick at 40ms, which left Remote Tilt claiming a write slot in every
/// alternating pair and starved telemetry polling while the pad was held. 100ms keeps a 10x margin on
/// the firmware timeout, matches Board Move's remote cadence, and leaves the link to telemetry.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt `REMOTE_TILT_REPEAT_MS`
private let REMOTE_TILT_REPEAT_MS: Int64 = 100

/// Time a full-range cancel takes to ease back to neutral; smaller tilts take proportionally less.
///
/// Dropping a large tilt straight to neutral is not safe on a self-balancing board: the firmware
/// reads the step as a big angle error and surges to correct it, which throws the rider forward.
/// Cancel therefore eases at a bounded rate instead of snapping.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt `REMOTE_TILT_CANCEL_FULL_RANGE_MS`
private let REMOTE_TILT_CANCEL_FULL_RANGE_MS: Int64 = 600

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

/// Streams Floaty's temporary remote-tilt input (0..255 slider, 128 neutral) to the board. Refloat
/// drops the remote input after ~1s of silence, so the active tilt is repeated on a fixed
/// `REMOTE_TILT_REPEAT_MS` tick. Requires `inputtilt_remote_type` to be set to UART in the board
/// config.
///
/// Two streams drive the 2D pad:
///  - `hold` keeps a constant tilt while the finger is down (live drag).
///  - `release` eases that tilt linearly back to neutral over a chosen duration once the finger
///    lifts.
///
/// The repeat loop is the sole sender: rapid drag updates only swap the active stream and never
/// schedule extra writes, so the serialized GATT queue is not flooded with stale packets (which
/// lagged the board the longer it was dragged).
///
/// Decay is tick-based rather than wall-clock: ticks fire at a fixed interval, so counting them is
/// equivalent to timing for a linear ramp and stays trivially testable.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt
internal final class RemoteTiltController {
  /// The tilt currently being streamed, as a function of elapsed ticks.
  private enum Stream {
    /// Constant tilt held while the finger is down.
    case hold(value: Int)
    /// Linear ease from `from` to neutral over `steps` ticks.
    case decay(from: Int, steps: Int)

    /// Tilt value to emit `tick` repeats into the stream.
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

    /// Whether the stream has reached neutral and should stop after `tick`.
    func finished(_ tick: Int) -> Bool {
      switch self {
      case .hold: return false
      case .decay(_, let steps): return tick >= steps
      }
    }
  }

  /// Supplies the active transport only while a tilt stream is allowed (board connected with a
  /// loaded config); `nil` otherwise.
  private let transport: () -> BoardTransport?
  /// Writes a framed payload to the board. `urgent` means neutral cancel input, which must pass
  /// normal traffic at the next write boundary.
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

  /// The tilt currently being commanded (0..255), or `REMOTE_TILT_CENTER` when idle. Reflects the
  /// held/easing target the controller is streaming, not the board's own ramped angle.
  var currentValue: Int { stream?.valueAt(tick) ?? REMOTE_TILT_CENTER }

  /// Whether the active hold is a lock (held until cancelled), not a live drag.
  var isLocked: Bool { locked }

  var phase: RemoteTiltPhase {
    guard let stream else { return .idle }
    if locked { return .locked }
    if case .decay = stream { return .decaying }
    return .holding
  }

  /// Exact native decay timing, used to render the pad's diagonal return path.
  var decayProgress: RemoteTiltDecayProgress? {
    guard case .decay(_, let steps) = stream else { return nil }
    return RemoteTiltDecayProgress(
      elapsedMs: Int64(tick) * REMOTE_TILT_REPEAT_MS,
      totalMs: Int64(steps) * REMOTE_TILT_REPEAT_MS
    )
  }

  /// Hold a constant tilt (live pad drag). Streams until `release` or `stop`.
  @discardableResult
  func hold(_ value: Int) -> Bool {
    let started = start(.hold(value: clampTilt(value)))
    if started { locked = false }
    return started
  }

  /// Lock a constant tilt, held indefinitely until `stop` or a new `hold`/`release`.
  @discardableResult
  func lock(_ value: Int) -> Bool {
    let started = start(.hold(value: clampTilt(value)))
    locked = started
    return started
  }

  /// Release the pad into a linear ease from `value` back to neutral over `durationMs`. A duration
  /// shorter than one tick snaps straight to neutral.
  @discardableResult
  func release(_ value: Int, durationMs: Int64) -> Bool {
    let steps = Int(durationMs / REMOTE_TILT_REPEAT_MS)
    if steps <= 0 { return stop() }
    let started = start(.decay(from: clampTilt(value), steps: steps))
    if started { locked = false }
    return started
  }

  /// Cancel the active tilt the way a rider expects: ease whatever is currently commanded back to
  /// neutral at a bounded rate (`REMOTE_TILT_CANCEL_FULL_RANGE_MS` for a full-range tilt) rather
  /// than snapping. Use `stop()` only for teardown, where an immediate neutral is the point.
  @discardableResult
  func cancel() -> Bool {
    let value = currentValue
    let distance = abs(value - REMOTE_TILT_CENTER)
    if distance == 0 { return stop() }
    let durationMs =
      Int64(distance) * REMOTE_TILT_CANCEL_FULL_RANGE_MS / Int64(255 - REMOTE_TILT_CENTER)
    return release(value, durationMs: durationMs)
  }

  /// Immediate neutral, no ease. Teardown only — see `cancel()` for the rider-facing cancel.
  @discardableResult
  func stop() -> Bool {
    let wasActive = stream != nil
    clear()

    // Snap to neutral so the board releases tilt immediately instead of waiting for its ~1s
    // remote-input timeout.
    if let transport = transport() {
      _ = send(buildRemoteTiltCommand(transport: transport, value: REMOTE_TILT_CENTER), true)
    }
    return wasActive
  }

  private func clampTilt(_ value: Int) -> Int { min(max(value, 0), 255) }

  private func start(_ next: Stream) -> Bool {
    guard let transport = transport() else { return false }

    // A running loop just picks up the new stream on its next tick; swapping mid-drag must not
    // flood the queue with an extra immediate write.
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
