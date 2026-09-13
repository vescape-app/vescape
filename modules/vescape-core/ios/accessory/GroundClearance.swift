import Foundation

/// The ground-clearance capability: the rider's calibration, the sample stream it reads, and the
/// one number a Remote Tilt binding is allowed to act on.
///
/// Pure and clock-free on purpose — every timestamp arrives as a parameter — so the rules below can
/// be asserted against `shared/fixtures/accessory-protocol/session.json` without a radio, a sensor
/// or a board. `AccessorySessionController` owns the wiring; this file owns the arithmetic.
///
/// The property everything else rests on: **a missing measurement is never a distance.** Not the top
/// of the range, not the last good value, not zero. A sensor that stopped answering releases the
/// input, and so does one answering with something this app cannot read.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceCalibration`
enum GroundClearance {
  /// Floor under the missing-stream timeout, `docs/accessory-protocol.md` PoC defaults.
  static let missingStreamFloorMs: Int64 = 300

  /// A binding that commands nothing is not a binding, so zero strength is not a calibration.
  static let minStrengthPercent = 1
  static let maxStrengthPercent = 100

  /// How long a capability may go without a sample before its input is released.
  ///
  /// Three sample periods, floored: at 20 Hz the floor is what matters, and a slow rate gets room
  /// for two dropped samples rather than being declared dead by a fixed 300 ms it never had a
  /// chance to meet.
  static func staleAfterMs(rateHz: Double) -> Int64 {
    guard rateHz.isFinite, rateHz > 0 else { return missingStreamFloorMs }
    return max(missingStreamFloorMs, Int64((3_000.0 / rateHz).rounded()))
  }

  /// The Refloat remote-input byte one signed correction asks for.
  ///
  /// The scale is the pad's: 128 is neutral and 255 is full nose-up, so a correction of 1.0 is the
  /// same command a rider dragging the pad to its right edge would send. Defined here rather than at
  /// the call site because both platforms and the tests have to agree on it byte for byte.
  ///
  /// A non-finite input is neutral, not a clamp to an extreme. Nothing should be able to produce one
  /// — `GroundClearanceCalibration.tiltInput` returns 0 for a non-finite distance — but the one
  /// place that decides what a board is told is not where to find out.
  static func tiltCommand(tiltInput: Double) -> Int {
    guard tiltInput.isFinite else { return REMOTE_TILT_CENTER }
    let span = Double(255 - REMOTE_TILT_CENTER)
    let scaled = Double(REMOTE_TILT_CENTER) + min(max(tiltInput, -1.0), 1.0) * span
    return min(max(Int(scaled.rounded()), 0), 255)
  }
}

/// Which way a mounted sensor corrects.
///
/// Kept as a wire string in `GroundClearanceCalibration` rather than parsed on the way in: a saved
/// row written by a newer build must be *rejected* as incomplete, not crash the session that read
/// it, and an unparsed direction is exactly the incomplete calibration the rider needs to fix.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceDirection`
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceDirection`
enum GroundClearanceDirection: String {
  /// Sensor at the nose: losing clearance there is answered by lifting the nose.
  case nose
  /// Sensor at the tail: the same loss is answered by lifting the tail.
  case tail

  static func fromWire(_ value: String?) -> GroundClearanceDirection? {
    guard let value else { return nil }
    return GroundClearanceDirection(rawValue: value)
  }
}

/// What the rider calibrated for one ground-clearance capability.
///
/// There is no partial state and no Save step: this is written when it is complete and valid, and a
/// calibration that is not both drives nothing. `farCm` is where correction starts and `nearCm` is
/// where it is at full strength, so `near < far` always — less clearance means more correction.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceCalibration`
/// @parity /modules/vescape-core/ios/telemetry/AccessoryPersistence.swift `SavedGroundClearance`
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceCalibration`
struct GroundClearanceCalibration: Equatable {
  let nearCm: Double
  let farCm: Double
  /// Raw wire value. Anything `GroundClearanceDirection` does not know makes this incomplete.
  let direction: String
  let strengthPercent: Int

  /// What is wrong with this calibration, or nil when nothing is.
  ///
  /// A reason rather than a boolean because the same absence — nothing saved, nothing driving — has
  /// to be explained differently depending on which rule it broke, and native is the only place
  /// that knows the rules. A screen that re-derived them would be a second definition of "valid"
  /// that could disagree with the one the binding actually uses.
  ///
  /// The declared window is part of the test, not just the numbers' own order. An accessory whose
  /// firmware narrowed its range is still the same accessory, and a calibration made against the
  /// old numbers has to stop driving rather than be silently squeezed into the new ones.
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

  /// Whether this is a calibration the hardware in front of us can actually be driven to.
  func isComplete(rangeMin: Double?, rangeMax: Double?) -> Bool {
    problem(rangeMin: rangeMin, rangeMax: rangeMax) == nil
  }

  /// The signed Remote Tilt input one measured distance calls for, in -1...1.
  ///
  /// Positive lifts the nose. Outside `[near, far]` the value saturates rather than extrapolating:
  /// a sensor reading closer than the near distance is already asking for everything there is, and
  /// one reading past the far distance is asking for nothing.
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

/// Why a calibration is not one yet.
///
/// The rider is mid-edit far more often than they are finished, so "not saved" is the normal state
/// of this screen and needs a sentence, not a silence.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceProblem`
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceProblem`
enum GroundClearanceProblem: String {
  /// A distance that is not a finite number. A row written by a broken build reads as this.
  case notANumber = "not-a-number"
  /// Less clearance must mean more correction, so the near distance has to be the smaller one.
  case nearNotBelowFar = "near-not-below-far"
  /// A mounting position this build does not know. A newer build wrote it; this one cannot use it.
  case unknownDirection = "unknown-direction"
  /// Zero commands nothing and past full commands something the pad cannot express.
  case strengthOutOfBounds = "strength-out-of-bounds"
  /// Outside what the accessory currently says it can measure. Recalibrate against the new limits.
  case outsideDeclaredRange = "outside-declared-range"
}

/// Why a ground-clearance binding is not commanding anything.
///
/// Carried rather than collapsed to a bare nil so the consumer — and the rider's screen — can say
/// which of these it is. "The sensor is reporting an error" and "the rider has not calibrated yet"
/// look identical as an absent number and are nothing alike to explain.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceRelease`
/// @parity /modules/vescape-core/src/index.ts `GroundClearanceRelease`
enum GroundClearanceRelease: String {
  /// Sensor-driven tilt is for riding. A parked board is not corrected.
  case notRiding = "not-riding"
  /// The Board is not connected, or its link is not Trusted.
  ///
  /// Decided by the Board Session, not here: this file knows what the sensor is saying and nothing
  /// about whether the thing on the other end is the Board the rider thinks it is.
  case boardUntrusted = "board-untrusted"
  /// The Board is connected but has stopped answering.
  ///
  /// Riding is read off telemetry, so telemetry that stopped is evidence that has stopped being
  /// evidence. Holding the last engaged frame's worth of permission would let a sensor keep tilting
  /// a Board nobody can hear.
  case boardStale = "board-stale"
  /// More than one calibrated ground-clearance capability wants the tilt channel.
  ///
  /// The PoC deliberately has no arbitration between a nose sensor and a tail sensor, and picking
  /// one of them arbitrarily would be picking a correction direction arbitrarily. Two claimants is a
  /// configuration the rider has to resolve, not one this app guesses its way through.
  case contested
  /// Board Move holds the remote-input slot. Both cannot write it, and a jog is the parked one.
  case boardMove = "board-move"
  /// A rider-commanded tilt still holds the slot.
  ///
  /// Only reachable in the moment a binding arms under a tilt that was started before it: the pad
  /// refuses new manual input for as long as a binding is bound, and the arming itself cancels
  /// whatever was held. It is named because an unexplained silent second is worse than a sentence.
  case manualTilt = "manual-tilt"
  /// No session, or a session that is not acknowledging commands.
  case noLink = "no-link"
  /// Nothing saved, or what is saved no longer fits the limits the accessory declares.
  case notCalibrated = "not-calibrated"
  /// Samples stopped arriving. The accessory may still be connected; it is not measuring.
  case stale
  /// The sensor answered, and the answer is not a distance.
  case outOfRange = "out-of-range"
  /// The sensor could not measure, or sent something this app cannot read as a measurement.
  case sensorError = "sensor-error"
}

/// The only thing a tilt binding is allowed to see.
///
/// Two cases and no third: either there is a calibrated, fresh, in-range measurement and a number to
/// command, or there is a reason to let go. Nothing here can be read as "hold the last value" — the
/// type has no way to express it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceInput`
enum GroundClearanceInput: Equatable {
  /// A live measurement, already scaled by the rider's strength and mounting direction.
  case drive(tiltInput: Double, valueCm: Double)
  /// Release any held input, smoothly, and command nothing until a `drive` arrives.
  case release(reason: GroundClearanceRelease)
}

/// Per-capability sample bookkeeping: what the newest accepted sample was, and when it landed here.
///
/// Deliberately *not* a ring buffer. Nothing in this slice looks backwards — the screen shows the
/// newest number and a tilt binding acts on the newest number — so a history would be a buffer whose
/// only job is to grow. `AccessoryLink` already coalesces commands; readings need the same
/// treatment, which is one slot.
///
/// Two clocks, kept apart on purpose. `AccessoryReading.sampleTimeMs` is the accessory's own uptime
/// and only ever compared to other samples from the same session; freshness is judged on
/// `latestAtMs`, this phone's monotonic receipt time. Subtracting one from the other would be a
/// latency measurement across two unsynchronised clocks.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `AccessoryReadingTracker`
final class AccessoryReadingTracker {
  /// Newest accepted sample, already range-checked. Nil until one arrives in this session.
  private(set) var latest: AccessoryReading?
  /// Local monotonic receipt time of `latest`, in milliseconds.
  private(set) var latestAtMs: Int64?

  private var lastSeq: Int?
  private var lastSampleTimeMs: Int64?

  /// Takes one sample if it is newer than what is held, and says whether it was taken.
  ///
  /// Sequence numbers increase across measurement pauses inside a session, so a jump is normal and
  /// only a repeat or a step backwards is a duplicate. A sample time that went backwards is refused
  /// even when the sequence advanced: the two disagree, and a disagreeing accessory is not one to
  /// take a distance from.
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

  /// A new protocol session restarts sequence numbers, so nothing from the old one may survive.
  func reset() {
    latest = nil
    latestAtMs = nil
    lastSeq = nil
    lastSampleTimeMs = nil
  }

  /// Whether a sample landed recently enough to still describe the ground under the board.
  func isFresh(nowMs: Int64, staleAfterMs: Int64) -> Bool {
    guard let at = latestAtMs else { return false }
    return nowMs - at < staleAfterMs
  }
}

/// One enrolled ground-clearance capability's live state: what is saved for it, who wants it
/// measuring, and what its samples currently amount to.
///
/// Demand is arbitrated here rather than anywhere a screen can reach. Two independent reasons to
/// measure — the rider is riding a calibrated board, or the rider has the configuration screen open
/// — and their union is what the accessory is told. Neither of them alone is permission to *tilt*:
/// `input` refuses on anything but riding, which is what keeps a preview from moving a parked board.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceRuntime`
final class GroundClearanceRuntime {
  let capabilityId: String

  /// Saved calibration, or nil while the rider has not finished one.
  var calibration: GroundClearanceCalibration?

  /// Limits from the live manifest. Nil while no session is established.
  var rangeMin: Double?
  var rangeMax: Double?

  /// Rate actually acknowledged for this capability, which sets the stale window.
  var rateHz: Double = 0

  /// The configuration screen is open and wants to show live numbers.
  var previewOpen = false

  /// The Board is connected and engaged. Set from the Board session, never from JS.
  var riding = false

  let tracker = AccessoryReadingTracker()
  let previewLog = ClearancePreviewLog()

  init(capabilityId: String) { self.capabilityId = capabilityId }

  /// Whether what is saved still fits what the accessory currently declares.
  var isCalibrated: Bool {
    calibration?.isComplete(rangeMin: rangeMin, rangeMax: rangeMax) == true
  }

  /// Whether the accessory should be measuring at all.
  ///
  /// Riding without a calibration measures nothing, because nothing could act on the result: the
  /// sensor would burn power to produce samples with no binding behind them. Preview measures
  /// regardless — that is how the rider *gets* a calibration.
  var measurementDemanded: Bool { previewOpen || (riding && isCalibrated) }

  /// What a tilt binding may do right now.
  ///
  /// Ordered by what the rider most needs to hear. Not riding comes first because it is the normal
  /// resting state and not a fault; the sensor's own problems come last, when everything that would
  /// have consumed them is in place.
  func input(nowMs: Int64, linkConnected: Bool) -> GroundClearanceInput {
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
      // Unreachable by construction — an `ok` without a value cannot be built — but a release is
      // the honest answer to a reading that somehow has none, and it costs one branch to never have
      // to trust that.
      guard let value = reading.valueCm else { return .release(reason: .sensorError) }
      return .drive(tiltInput: saved.tiltInput(valueCm: value), valueCm: value)
    }
  }

  /// Everything a fresh protocol session invalidates. Calibration is durable and stays.
  func onSessionLost() {
    tracker.reset()
    previewLog.reset()
    rateHz = 0
  }
}

/// Owns every live ground-clearance binding across enrolled Accessories.
///
/// The generic session coordinator supplies connection facts and protocol commands. Capability
/// state, demand, readings, calibration application, and claimant selection live here.
///
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
    accessoryId: String, capability: AccessoryCapability, liveManifest: Bool, rateHz: Double
  ) -> AccessoryCommand {
    let state = runtime(accessoryId, capability.id)
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
      state.isCalibrated && link(key.accessoryId, key.capabilityId).connected ? key : nil
    }
  }

  func bound(_ link: (String, String) -> LinkState) -> Bool { !boundCapabilities(link).isEmpty }

  func tilt(_ link: (String, String) -> LinkState) -> GroundClearanceInput {
    let bound = boundCapabilities(link)
    if bound.count > 1 { return .release(reason: .contested) }
    guard let key = bound.first else {
      return .release(reason: runtimes.values.contains(where: { $0.isCalibrated }) ? .noLink : .notCalibrated)
    }
    return input(key.accessoryId, key.capabilityId, link: link(key.accessoryId, key.capabilityId))
  }

  func acceptReading(
    _ accessoryId: String, _ reading: AccessoryReading, receivedAtMs: Int64, appliedRateHz: Double?
  ) -> [String: Any?]? {
    let key = Key(accessoryId: accessoryId, capabilityId: reading.capabilityId)
    guard let state = runtimes[key] else { return nil }
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
    ]
  }

  func onSessionLost(_ accessoryId: String) {
    for (key, state) in runtimes where key.accessoryId == accessoryId { state.onSessionLost() }
  }

  func forget(_ accessoryId: String) {
    runtimes = runtimes.filter { $0.key.accessoryId != accessoryId }
  }
}

/// Board-side lifecycle and arbitration for the ground-clearance Accessory Binding.
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
    // Every tick, not just the arming one. A manual tilt that survives into a bound session — one
    // taken in the window before the pad learned it was read-only, or one whose arming-time cancel
    // failed on a transport that blinked — is a lock that never ends by itself, and the read-only
    // pad has no Cancel for the rider to press. `releaseManual` no-ops once the ease is running, so
    // repeating it costs nothing.
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
