import Foundation

/// One decoded Board sample retained inside a VESC Fault Capture.
///
/// A projection of the decoded telemetry tick, not a Telemetry Sample: no GPS, no derived Ride
/// History fields, nothing that would make this evidence depend on Ride Recording. Every field is
/// optional because a firmware may simply not report it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt `VescFaultCaptureSample`
/// @parity /modules/vescape-core/src/index.ts `VescFaultCaptureSample`
struct VescFaultCaptureSample {
  let capturedAtMs: Int64
  let speed: Double?
  let dutyCycle: Double?
  let erpm: Double?
  let batteryVoltage: Double?
  let batteryCurrent: Double?
  let motorCurrent: Double?
  let tempMosfet: Double?
  let tempMotor: Double?
  let pitch: Double?
  let roll: Double?
  let balancePitch: Double?
  let adc1: Double?
  let adc2: Double?
  let state: Int?

  func toMap() -> [String: Any?] {
    [
      "capturedAtMs": capturedAtMs,
      "speed": speed,
      "dutyCycle": dutyCycle,
      "erpm": erpm,
      "batteryVoltage": batteryVoltage,
      "batteryCurrent": batteryCurrent,
      "motorCurrent": motorCurrent,
      "tempMosfet": tempMosfet,
      "tempMotor": tempMotor,
      "pitch": pitch,
      "roll": roll,
      "balancePitch": balancePitch,
      "adc1": adc1,
      "adc2": adc2,
      "state": state,
    ]
  }

  /// Project one decoded live-window map into a capture sample. Returns nil when the map carries no
  /// `lastPacketAt` — an untimestamped row cannot be placed inside a capture window.
  static func fromLiveSample(_ map: [String: Any?]) -> VescFaultCaptureSample? {
    func num(_ key: String) -> Double? {
      guard let raw = map[key] ?? nil else { return nil }
      if let d = raw as? Double { return d }
      if let i = raw as? Int { return Double(i) }
      if let i = raw as? Int64 { return Double(i) }
      if let n = raw as? NSNumber { return n.doubleValue }
      return nil
    }
    guard let capturedAt = num("lastPacketAt").map({ Int64($0) }) else { return nil }
    return VescFaultCaptureSample(
      capturedAtMs: capturedAt,
      speed: num("speed"),
      dutyCycle: num("dutyCycle"),
      erpm: num("erpm"),
      batteryVoltage: num("batteryVoltage"),
      batteryCurrent: num("batteryCurrent"),
      motorCurrent: num("motorCurrent"),
      tempMosfet: num("tempMosfet"),
      tempMotor: num("tempMotor"),
      pitch: num("pitch"),
      roll: num("roll"),
      balancePitch: num("balancePitch"),
      adc1: num("adc1"),
      adc2: num("adc2"),
      state: num("state").map { Int($0) }
    )
  }
}

/// Metadata for one VESC Fault Capture. The occurrence id is the foreign key: one occurrence owns at
/// most one capture, and the capture outlives the Board Session that produced it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt `VescFaultCapture`
/// @parity /modules/vescape-core/src/index.ts `VescFaultCapture`
struct VescFaultCapture {
  let occurrenceId: String
  let boardId: String
  /// Intended start of the window: detection minus `VescFaultCaptureCoordinator.preRollMs`.
  let startedAtMs: Int64
  /// When the fault was detected — the boundary between pre-roll and incident.
  let openedAtMs: Int64
  /// Timestamp of the last retained sample, or nil while the capture is still appending.
  let endedAtMs: Int64?
  let sampleCount: Int
  /// True only when the full two-second post-clear tail was observed.
  let complete: Bool

  func toMap() -> [String: Any?] {
    [
      "occurrenceId": occurrenceId,
      "boardId": boardId,
      "startedAtMs": startedAtMs,
      "openedAtMs": openedAtMs,
      "endedAtMs": endedAtMs,
      "sampleCount": sampleCount,
      "complete": complete,
    ]
  }
}

/// Narrow durable persistence for VESC Fault Captures. Production is `VescFaultCaptureStore`; tests
/// supply an in-memory fake so window boundaries are exercised without a database or BLE.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt `VescFaultCaptureStore`
protocol VescFaultCaptureStoring {
  func upsertCapture(_ capture: VescFaultCapture)
  func appendSamples(_ occurrenceId: String, _ samples: [VescFaultCaptureSample])
  func getCapture(_ occurrenceId: String) -> VescFaultCapture?
  func getSamples(_ occurrenceId: String) -> [VescFaultCaptureSample]
}

/// Deterministic owner of VESC Fault Capture windows.
///
/// One occurrence owns every decoded Board sample from `preRollMs` before detection through
/// `tailMs` after the controller reported a clear. The pre-roll is copied out of the native recent
/// decoded window that already backs `board.recentTelemetry` — deliberately **not** a second
/// always-on buffer — and persisted immediately, so a process kill loses only the tail.
///
/// Windows are bounded by timestamps, never by sample counts: the Board Session is response-paced,
/// so a capture describes the rate actually achieved rather than a fabricated 30 Hz cadence.
///
/// Captures are self-contained. A direct A-to-B code change closes A's window (which keeps appending
/// through its tail) and opens B's with its own five-second pre-roll, so the two intentionally
/// duplicate samples and each stays independently inspectable.
///
/// Session or process end finalizes what exists and marks the capture incomplete. It never fabricates
/// a clear time — that belongs to `VescFaultCoordinator`, and the controller never said it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt
final class VescFaultCaptureCoordinator {
  /// Decoded samples retained before detection.
  static let preRollMs: Int64 = 5_000

  /// Decoded samples retained after the controller reported a clear.
  static let tailMs: Int64 = 2_000

  /// Buffered samples before a window asks for a flush.
  static let flushThreshold = 32

  static let shared = VescFaultCaptureCoordinator(store: VescFaultCaptureStore.shared)

  /// Snapshot of the native recent decoded window, wired by the Board Session to
  /// `LiveSeriesEmitter.recentSnapshot`. Nil outside a session — a capture then opens empty and
  /// fills from live samples only.
  var recentWindow: (() -> [[String: Any?]])?

  private final class Window {
    let occurrenceId: String
    let boardId: String
    let startedAtMs: Int64
    let openedAtMs: Int64
    /// Set when the occurrence cleared: the last sample timestamp still admitted into the window.
    var tailDeadlineMs: Int64?
    var sampleCount = 0
    var lastSampleAtMs: Int64?
    var finished = false
    var pending: [VescFaultCaptureSample] = []

    init(occurrenceId: String, boardId: String, startedAtMs: Int64, openedAtMs: Int64) {
      self.occurrenceId = occurrenceId
      self.boardId = boardId
      self.startedAtMs = startedAtMs
      self.openedAtMs = openedAtMs
    }

    func snapshot(ended: Bool) -> VescFaultCapture {
      let tailObserved = tailDeadlineMs.map { (lastSampleAtMs ?? Int64.min) >= $0 } ?? false
      return VescFaultCapture(
        occurrenceId: occurrenceId,
        boardId: boardId,
        startedAtMs: startedAtMs,
        openedAtMs: openedAtMs,
        endedAtMs: ended ? (lastSampleAtMs ?? openedAtMs) : nil,
        sampleCount: sampleCount,
        complete: ended && tailObserved
      )
    }
  }

  private let store: VescFaultCaptureStoring
  private let lock = NSLock()
  private var windows: [Window] = []
  /// Serial writer: every durable write is handed off here so the BLE callback thread never blocks
  /// on SQLite, and so ordering (pre-roll before appends) is preserved. Mirrors Android's single
  /// `warningWriteDispatcher`.
  private let writeQueue: DispatchQueue?

  init(store: VescFaultCaptureStoring, writeQueue: DispatchQueue? = DispatchQueue(label: "vescape.faultCapture.write")) {
    self.store = store
    self.writeQueue = writeQueue
  }

  /// Run a durable write on the serial writer, or inline when tests pass `writeQueue: nil` so
  /// assertions observe the store synchronously.
  private func persist(_ work: @escaping () -> Void) {
    guard let writeQueue else {
      work()
      return
    }
    writeQueue.async(execute: work)
  }

  /// A new occurrence opened. Copies the pre-roll out of the recent decoded window and persists it
  /// before returning, so the five seconds leading into the incident survive a process kill.
  func openCapture(occurrenceId: String, boardId: String, openedAtMs: Int64) {
    let startedAtMs = openedAtMs - Self.preRollMs
    let prefix = (recentWindow?() ?? [])
      .compactMap(VescFaultCaptureSample.fromLiveSample)
      .filter { $0.capturedAtMs >= startedAtMs && $0.capturedAtMs <= openedAtMs }
    let window = Window(
      occurrenceId: occurrenceId, boardId: boardId, startedAtMs: startedAtMs, openedAtMs: openedAtMs
    )
    window.sampleCount = prefix.count
    window.lastSampleAtMs = prefix.last?.capturedAtMs
    lock.lock()
    windows.append(window)
    let snapshot = window.snapshot(ended: false)
    lock.unlock()
    persist { [store] in
      store.upsertCapture(snapshot)
      if !prefix.isEmpty { store.appendSamples(occurrenceId, prefix) }
    }
  }

  /// The occurrence cleared (or was displaced by another code). The window keeps appending until a
  /// sample arrives more than `tailMs` after the clear.
  func closeCapture(occurrenceId: String, clearedAtMs: Int64) {
    lock.lock()
    windows.first { $0.occurrenceId == occurrenceId }?.tailDeadlineMs = clearedAtMs + Self.tailMs
    lock.unlock()
  }

  /// Offer one decoded live sample to every open window of this Board. Runs on the BLE hot path, so
  /// it only touches memory: returns true when `flush()` should be called.
  @discardableResult
  func observeSample(boardId: String, _ map: [String: Any?]) -> Bool {
    lock.lock()
    let empty = windows.isEmpty
    lock.unlock()
    if empty { return false }
    guard let sample = VescFaultCaptureSample.fromLiveSample(map) else { return false }
    lock.lock()
    defer { lock.unlock() }
    var needsFlush = false
    for window in windows where window.boardId == boardId && !window.finished {
      if let deadline = window.tailDeadlineMs, sample.capturedAtMs > deadline {
        window.finished = true
        needsFlush = true
        continue
      }
      window.pending.append(sample)
      window.sampleCount += 1
      window.lastSampleAtMs = sample.capturedAtMs
      if window.pending.count >= Self.flushThreshold { needsFlush = true }
    }
    return needsFlush
  }

  /// Persist buffered samples and retire windows whose tail elapsed.
  func flush() {
    lock.lock()
    let work: [(VescFaultCapture, [VescFaultCaptureSample], Bool)] = windows.map { window in
      let samples = window.pending
      window.pending.removeAll(keepingCapacity: true)
      return (window.snapshot(ended: window.finished), samples, window.finished)
    }
    windows.removeAll { $0.finished }
    lock.unlock()
    persist { [store] in
      for (capture, samples, retired) in work {
        if !samples.isEmpty { store.appendSamples(capture.occurrenceId, samples) }
        if !samples.isEmpty || retired { store.upsertCapture(capture) }
      }
    }
  }

  /// The Board Session ended. Persists what each window holds and marks it complete only if the full
  /// post-clear tail had already been observed. No clear time is invented.
  func onSessionEnded(boardId: String) {
    lock.lock()
    let work: [(VescFaultCapture, [VescFaultCaptureSample])] = windows
      .filter { $0.boardId == boardId }
      .map { window in
        let samples = window.pending
        window.pending.removeAll(keepingCapacity: true)
        return (window.snapshot(ended: true), samples)
      }
    windows.removeAll { $0.boardId == boardId }
    lock.unlock()
    persist { [store] in
      for (capture, samples) in work {
        if !samples.isEmpty { store.appendSamples(capture.occurrenceId, samples) }
        store.upsertCapture(capture)
      }
    }
  }

  func capture(_ occurrenceId: String) -> VescFaultCapture? { store.getCapture(occurrenceId) }

  func samples(_ occurrenceId: String) -> [VescFaultCaptureSample] { store.getSamples(occurrenceId) }
}
