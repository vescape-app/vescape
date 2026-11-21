import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteInputArbiter.kt `RemoteInputOwner`
/// @parity /modules/vescape-core/src/index.ts `RemoteTiltOwner`
internal enum RemoteInputOwner: String {
  case none
  case manual
  case sensor
  case move

  var wire: String { rawValue }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteInputArbiter.kt `SENSOR_TILT_SLEW_FULL_RANGE_MS`
private let SENSOR_TILT_SLEW_FULL_RANGE_MS = REMOTE_TILT_CANCEL_FULL_RANGE_MS

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteInputArbiter.kt
internal final class RemoteInputArbiter {
  private let tilt: RemoteTiltController
  private let move: BoardMoveController
  private let nowMs: () -> Int64

  private let sensorBound: () -> Bool

  private var tiltOwner: RemoteInputOwner = .none

  private var sensorEngaged = false

  private var sensorValue = REMOTE_TILT_CENTER
  private var sensorAtMs: Int64 = 0

  init(
    tilt: RemoteTiltController,
    move: BoardMoveController,
    nowMs: @escaping () -> Int64,
    sensorBound: @escaping () -> Bool = { false }
  ) {
    self.tilt = tilt
    self.move = move
    self.nowMs = nowMs
    self.sensorBound = sensorBound
  }

  var owner: RemoteInputOwner {
    if move.isMoving { return .move }
    if tilt.phase == .idle { return .none }
    return tiltOwner
  }

  var sensorCommand: Int { sensorEngaged ? sensorValue : REMOTE_TILT_CENTER }

  @discardableResult
  func manualHold(_ value: Int) -> Bool { claimManual { self.tilt.hold(value) } }

  @discardableResult
  func manualLock(_ value: Int) -> Bool { claimManual { self.tilt.lock(value) } }

  @discardableResult
  func manualRelease(_ value: Int, durationMs: Int64) -> Bool {
    claimManual { self.tilt.release(value, durationMs: durationMs) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteInputArbiter.kt `manualBlocker`
  var manualBlocker: RemoteInputOwner? {
    if sensorBound() { return .sensor }
    switch owner {
    case .sensor, .move: return owner
    case .none, .manual: return nil
    }
  }

  private func claimManual(_ start: () -> Bool) -> Bool {
    if manualBlocker != nil { return false }
    let started = start()
    if started { tiltOwner = .manual }
    return started
  }

  @discardableResult
  func cancelTilt() -> Bool {
    _ = releaseSensor()
    return tilt.cancel()
  }

  @discardableResult
  func releaseManual() -> Bool {
    guard owner == .manual else { return false }
    guard tilt.phase != .decaying else { return false }
    return tilt.cancel()
  }

  @discardableResult
  func sensorDrive(_ target: Int) -> Bool {
    switch owner {
    case .move, .manual:
      sensorEngaged = false
      return false
    case .none, .sensor:
      break
    }
    let now = nowMs()
    let from: Int
    if sensorEngaged {
      from = sensorValue
    } else if tilt.phase != .idle {
      from = tilt.currentValue
    } else {
      from = REMOTE_TILT_CENTER
    }
    let elapsed = sensorEngaged ? max(0, now - sensorAtMs) : 0
    let next = slew(from: from, target: min(max(target, 0), 255), elapsedMs: elapsed)
    sensorEngaged = true
    sensorValue = next
    sensorAtMs = now
    tiltOwner = .sensor
    return tilt.hold(next)
  }

  @discardableResult
  func sensorRelease() -> Bool {
    guard releaseSensor() else { return false }
    guard owner == .sensor else { return false }
    return tilt.cancel()
  }

  private func releaseSensor() -> Bool {
    guard sensorEngaged else { return false }
    sensorEngaged = false
    sensorValue = REMOTE_TILT_CENTER
    return true
  }

  @discardableResult
  func startMove(_ input: Int) -> Bool {
    if sensorEngaged { return false }
    if tilt.phase != .idle { _ = tilt.stop() }
    _ = releaseSensor()
    tiltOwner = .none
    return move.hold(input)
  }

  @discardableResult
  func stopMove() -> Bool { move.stop() }

  func reset() {
    _ = releaseSensor()
    tiltOwner = .none
    _ = tilt.stop()
    _ = move.stop()
  }

  private func slew(from: Int, target: Int, elapsedMs: Int64) -> Int {
    let distance = abs(target - from)
    if distance == 0 { return target }
    let fullRange = Int64(255 - REMOTE_TILT_CENTER)
    let allowed = Int(fullRange * elapsedMs / SENSOR_TILT_SLEW_FULL_RANGE_MS)
    let step = min(distance, max(1, allowed))
    return target > from ? from + step : from - step
  }
}
