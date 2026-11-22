import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceCalibration`
enum GroundClearance {
  static let missingStreamFloorMs: Int64 = 300

  static let minStrengthPercent = 1
  static let maxStrengthPercent = 100

  static func staleAfterMs(rateHz: Double) -> Int64 {
    guard rateHz.isFinite, rateHz > 0 else { return missingStreamFloorMs }
    return max(missingStreamFloorMs, Int64((3_000.0 / rateHz).rounded()))
  }

  static func tiltCommand(tiltInput: Double) -> Int {
    guard tiltInput.isFinite else { return REMOTE_TILT_CENTER }
    let span = Double(255 - REMOTE_TILT_CENTER)
    let scaled = Double(REMOTE_TILT_CENTER) + min(max(tiltInput, -1.0), 1.0) * span
    return min(max(Int(scaled.rounded()), 0), 255)
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceDirection`
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceDirection`
enum GroundClearanceDirection: String {
  case nose
  case tail

  static func fromWire(_ value: String?) -> GroundClearanceDirection? {
    guard let value else { return nil }
    return GroundClearanceDirection(rawValue: value)
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceCalibration`
/// @parity /modules/vescape-core/ios/telemetry/AccessoryPersistence.swift `SavedGroundClearance`
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceCalibration`
struct GroundClearanceCalibration: Equatable {
  let nearCm: Double
  let farCm: Double
  let direction: String
  let strengthPercent: Int

  func problem(rangeMin: Double?, rangeMax: Double?) -> GroundClearanceProblem? {
    guard nearCm.isFinite, farCm.isFinite else { return .notANumber }
    guard nearCm < farCm else { return .nearNotBelowFar }
    guard GroundClearanceDirection.fromWire(direction) != nil else { return .unknownDirection }
    guard strengthPercent >= GroundClearance.minStrengthPercent else { return .strengthOutOfBounds }
    guard strengthPercent <= GroundClearance.maxStrengthPercent else { return .strengthOutOfBounds }
    if let rangeMin, nearCm < rangeMin { return .outsideDeclaredRange }
    if let rangeMax, farCm > rangeMax { return .outsideDeclaredRange }
    return nil
  }

  func isComplete(rangeMin: Double?, rangeMax: Double?) -> Bool {
    problem(rangeMin: rangeMin, rangeMax: rangeMax) == nil
  }

  func tiltInput(valueCm: Double) -> Double {
    guard valueCm.isFinite else { return 0 }
    let span = farCm - nearCm
    guard span > 0 else { return 0 }
    let fraction = min(max((farCm - valueCm) / span, 0), 1)
    let magnitude = fraction * (Double(strengthPercent) / 100.0)
    switch GroundClearanceDirection.fromWire(direction) {
    case .nose: return magnitude
    case .tail: return -magnitude
    case nil: return 0
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceProblem`
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceProblem`
enum GroundClearanceProblem: String {
  case notANumber = "not-a-number"
  case nearNotBelowFar = "near-not-below-far"
  case unknownDirection = "unknown-direction"
  case strengthOutOfBounds = "strength-out-of-bounds"
  case outsideDeclaredRange = "outside-declared-range"
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceRelease`
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceRelease`
enum GroundClearanceRelease: String {
  case disabled
  case notRiding = "not-riding"
  case boardUntrusted = "board-untrusted"
  case boardStale = "board-stale"
  case contested
  case boardMove = "board-move"
  case manualTilt = "manual-tilt"
  case noLink = "no-link"
  case notCalibrated = "not-calibrated"
  case stale
  case outOfRange = "out-of-range"
  case sensorError = "sensor-error"
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceInput`
enum GroundClearanceInput: Equatable {
  case drive(tiltInput: Double, valueCm: Double)
  case release(reason: GroundClearanceRelease)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `AccessoryReadingTracker`
final class AccessoryReadingTracker {
  private(set) var latest: AccessoryReading?
  private(set) var latestAtMs: Int64?

  private var lastSeq: Int?
  private var lastSampleTimeMs: Int64?

  @discardableResult
  func accept(_ reading: AccessoryReading, receivedAtMs: Int64) -> Bool {
    if let previousSeq = lastSeq, reading.seq <= previousSeq { return false }
    if let previousTime = lastSampleTimeMs, reading.sampleTimeMs < previousTime { return false }
    lastSeq = reading.seq
    lastSampleTimeMs = reading.sampleTimeMs
    latest = reading
    latestAtMs = receivedAtMs
    return true
  }

  func reset() {
    latest = nil
    latestAtMs = nil
    lastSeq = nil
    lastSampleTimeMs = nil
  }

  func isFresh(nowMs: Int64, staleAfterMs: Int64) -> Bool {
    guard let at = latestAtMs else { return false }
    return nowMs - at < staleAfterMs
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceRuntime`
final class GroundClearanceRuntime {
  let capabilityId: String

  var calibration: GroundClearanceCalibration?

  var rangeMin: Double?
  var rangeMax: Double?

  var rateHz: Double = 0

  var previewOpen = false

  var riding = false

  let tracker = AccessoryReadingTracker()
  let previewLog = ClearancePreviewLog()

  init(capabilityId: String) { self.capabilityId = capabilityId }

  var isCalibrated: Bool {
    calibration?.isComplete(rangeMin: rangeMin, rangeMax: rangeMax) == true
  }

  var enabled = true
  var measurementDemanded: Bool { enabled && (previewOpen || (riding && isCalibrated)) }

  func input(nowMs: Int64, linkConnected: Bool) -> GroundClearanceInput {
    if !enabled { return .release(reason: .disabled) }
    guard riding else { return .release(reason: .notRiding) }
    guard linkConnected else { return .release(reason: .noLink) }
    guard let saved = calibration, saved.isComplete(rangeMin: rangeMin, rangeMax: rangeMax) else {
      return .release(reason: .notCalibrated)
    }
    guard let reading = tracker.latest,
      tracker.isFresh(nowMs: nowMs, staleAfterMs: GroundClearance.staleAfterMs(rateHz: rateHz))
    else { return .release(reason: .stale) }

    switch reading.status {
    case .outOfRange: return .release(reason: .outOfRange)
    case .error: return .release(reason: .sensorError)
    case .ok:
      guard let value = reading.valueCm else { return .release(reason: .sensorError) }
      return .drive(tiltInput: saved.tiltInput(valueCm: value), valueCm: value)
    }
  }

  func onSessionLost() {
    tracker.reset()
    previewLog.reset()
    rateHz = 0
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceBindingController`
final class GroundClearanceBindingController {
  struct Key: Hashable {
    let accessoryId: String
    let capabilityId: String
  }

  struct LinkState {
    let connected: Bool
    let appliedRateHz: Double
  }

  private let nowMs: () -> Int64
  private var runtimes: [Key: GroundClearanceRuntime] = [:]
  private var riding = false

  init(nowMs: @escaping () -> Int64) { self.nowMs = nowMs }

  func reset(_ calibrations: [(Key, GroundClearanceCalibration)]) {
    runtimes.removeAll()
    for (key, calibration) in calibrations { runtime(key).calibration = calibration }
  }

  private func runtime(_ accessoryId: String, _ capabilityId: String) -> GroundClearanceRuntime {
    runtime(Key(accessoryId: accessoryId, capabilityId: capabilityId))
  }

  private func runtime(_ key: Key) -> GroundClearanceRuntime {
    if let existing = runtimes[key] { return existing }
    let created = GroundClearanceRuntime(capabilityId: key.capabilityId)
    runtimes[key] = created
    return created
  }

  func applyCapability(
    accessoryId: String, capability: AccessoryCapability, liveManifest: Bool, rateHz: Double,
    enabled: Bool = true
  ) -> AccessoryCommand {
    let state = runtime(accessoryId, capability.id)
    if state.enabled != enabled { state.onSessionLost() }
    state.enabled = enabled
    if liveManifest {
      state.rangeMin = capability.rangeMin
      state.rangeMax = capability.rangeMax
    }
    state.riding = riding
    return .configure(capabilityId: capability.id, enabled: state.measurementDemanded, rateHz: rateHz)
  }

  func setPreview(_ accessoryId: String, _ capabilityId: String, open: Bool) -> Bool {
    let state = runtime(accessoryId, capabilityId)
    guard state.previewOpen != open else { return false }
    state.previewLog.reset()
    state.previewOpen = open
    return true
  }

  func releasePreviews() -> Bool {
    var changed = false
    for state in runtimes.values where state.previewOpen {
      state.previewOpen = false
      changed = true
    }
    return changed
  }

  func setRiding(_ value: Bool) -> Bool {
    guard riding != value else { return false }
    riding = value
    return true
  }

  func validate(
    _ accessoryId: String, _ capabilityId: String, _ calibration: GroundClearanceCalibration
  ) -> GroundClearanceProblem? {
    let state = runtime(accessoryId, capabilityId)
    return calibration.problem(rangeMin: state.rangeMin, rangeMax: state.rangeMax)
  }

  func applyCalibration(
    _ accessoryId: String, _ capabilityId: String, _ calibration: GroundClearanceCalibration
  ) { runtime(accessoryId, capabilityId).calibration = calibration }

  func clearCalibration(_ accessoryId: String, _ capabilityId: String) {
    runtime(accessoryId, capabilityId).calibration = nil
  }

  func describe(_ accessoryId: String, _ capabilityId: String) -> [String: Any?]? {
    guard let state = runtimes[Key(accessoryId: accessoryId, capabilityId: capabilityId)] else {
      return nil
    }
    let calibration: [String: Any?]? = state.calibration.map {
      [
        "nearCm": $0.nearCm,
        "farCm": $0.farCm,
        "direction": $0.direction,
        "strengthPercent": $0.strengthPercent,
        "problem": $0.problem(rangeMin: state.rangeMin, rangeMax: state.rangeMax)?.rawValue,
      ]
    }
    return ["calibration": calibration, "measuring": state.measurementDemanded]
  }

  func input(_ accessoryId: String, _ capabilityId: String, link: LinkState) -> GroundClearanceInput {
    guard let state = runtimes[Key(accessoryId: accessoryId, capabilityId: capabilityId)] else {
      return .release(reason: .notCalibrated)
    }
    state.rateHz = link.appliedRateHz
    return state.input(nowMs: nowMs(), linkConnected: link.connected)
  }

  private func boundCapabilities(_ link: (String, String) -> LinkState) -> [Key] {
    runtimes.compactMap { key, state in
      state.enabled && state.isCalibrated && link(key.accessoryId, key.capabilityId).connected ? key : nil
    }
  }

  func bound(_ link: (String, String) -> LinkState) -> Bool { !boundCapabilities(link).isEmpty }

  func tilt(_ link: (String, String) -> LinkState) -> GroundClearanceInput {
    let bound = boundCapabilities(link)
    if bound.count > 1 { return .release(reason: .contested) }
    guard let key = bound.first else {
      if !runtimes.isEmpty && !runtimes.values.contains(where: { $0.enabled }) { return .release(reason: .disabled) }
      return .release(reason: runtimes.values.contains(where: { $0.enabled && $0.isCalibrated }) ? .noLink : .notCalibrated)
    }
    return input(key.accessoryId, key.capabilityId, link: link(key.accessoryId, key.capabilityId))
  }

  func acceptReading(
    _ accessoryId: String, _ reading: AccessoryReading, receivedAtMs: Int64, appliedRateHz: Double?
  ) -> [String: Any?]? {
    let key = Key(accessoryId: accessoryId, capabilityId: reading.capabilityId)
    guard let state = runtimes[key] else { return nil }
    guard state.enabled else { return nil }
    if let appliedRateHz { state.rateHz = appliedRateHz }
    let checked = reading.withinDeclaredRange(rangeMin: state.rangeMin, rangeMax: state.rangeMax)
    guard state.tracker.accept(checked, receivedAtMs: receivedAtMs), state.previewOpen else { return nil }
    state.previewLog.record(at: receivedAtMs, time: checked.sampleTimeMs, seq: Int64(checked.seq), value: checked.valueCm)
    guard state.previewLog.shouldEmit(at: receivedAtMs) else { return nil }
    return [
      "diagnostics": state.previewLog.snapshot(at: receivedAtMs),
      "accessoryId": accessoryId,
      "capabilityId": checked.capabilityId,
      "seq": checked.seq,
      "sampleTimeMs": checked.sampleTimeMs,
      "status": checked.status.rawValue,
      "valueCm": checked.valueCm,
      "staleAfterMs": GroundClearance.staleAfterMs(rateHz: state.rateHz),
      "tiltPreviewPercent": checked.valueCm.flatMap { value in
        state.isCalibrated ? state.calibration.map { $0.tiltInput(valueCm: value) * 100 } : nil
      },
    ]
  }

  func onSessionLost(_ accessoryId: String) {
    for (key, state) in runtimes where key.accessoryId == accessoryId { state.onSessionLost() }
  }

  func forget(_ accessoryId: String) {
    runtimes = runtimes.filter { $0.key.accessoryId != accessoryId }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `BoardGroundClearanceBinding`
final class BoardGroundClearanceBinding {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `TICK_MS`
  static let tickMs: Int64 = 100

  struct BoardInput {
    let commandsTrusted: Bool
    let telemetryFresh: Bool
  }

  private let remoteInput: RemoteInputArbiter
  private let boundInput: () -> Bool
  private let tiltInput: () -> GroundClearanceInput
  private var scheduled: Cancellable?
  private var schedule: ((@escaping () -> Void) -> Cancellable)?
  private var boardInput: (() -> BoardInput)?
  private var bound = false
  private var release: GroundClearanceRelease? = .notCalibrated

  init(
    remoteInput: RemoteInputArbiter,
    boundInput: @escaping () -> Bool,
    tiltInput: @escaping () -> GroundClearanceInput
  ) {
    self.remoteInput = remoteInput
    self.boundInput = boundInput
    self.tiltInput = tiltInput
  }

  func start(
    schedule: @escaping (@escaping () -> Void) -> Cancellable,
    boardInput: @escaping () -> BoardInput
  ) {
    guard scheduled == nil else { return }
    self.schedule = schedule
    self.boardInput = boardInput
    scheduleNext()
  }

  private func scheduleNext() {
    scheduled = schedule? { [weak self] in
      guard let self, let boardInput = self.boardInput else { return }
      self.tick(boardInput())
      self.scheduleNext()
    }
  }

  func stop() {
    scheduled?.cancel()
    scheduled = nil
    schedule = nil
    boardInput = nil
    _ = remoteInput.sensorRelease()
    bound = false
    release = .boardUntrusted
  }

  func tick(_ board: BoardInput) {
    bound = boundInput()
    if bound { _ = remoteInput.releaseManual() }

    let input: GroundClearanceInput
    if !board.commandsTrusted {
      input = .release(reason: .boardUntrusted)
    } else if !board.telemetryFresh {
      input = .release(reason: .boardStale)
    } else {
      switch remoteInput.owner {
      case .move: input = .release(reason: .boardMove)
      case .manual: input = .release(reason: .manualTilt)
      case .none, .sensor: input = tiltInput()
      }
    }

    switch input {
    case .drive(let tiltInput, _):
      release = remoteInput.sensorDrive(GroundClearance.tiltCommand(tiltInput: tiltInput))
        ? nil : .boardUntrusted
    case .release(let reason):
      _ = remoteInput.sensorRelease()
      release = reason
    }
  }

  func state() -> [String: Any?] {
    [
      "bound": bound,
      "driving": remoteInput.owner == .sensor,
      "release": release?.rawValue,
    ]
  }
}
