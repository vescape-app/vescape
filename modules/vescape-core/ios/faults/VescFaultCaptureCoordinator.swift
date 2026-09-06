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
  let sampleCount: Int

  func toMap() -> [String: Any?] {
    [
      "occurrenceId": occurrenceId,
      "boardId": boardId,
      "startedAtMs": startedAtMs,
      "openedAtMs": openedAtMs,
      "sampleCount": sampleCount,
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

/// Copies the native recent-telemetry window once when a live fault opens. No future samples, open
/// windows, flush lifecycle, or session-end reconciliation.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt
final class VescFaultCaptureCoordinator {
  /// Decoded samples retained before detection.
  static let preRollMs: Int64 = 5_000

  static let shared = VescFaultCaptureCoordinator(store: VescFaultCaptureStore.shared)

  /// Snapshot of the native recent decoded window, wired by the Board Session to
  /// `LiveSeriesEmitter.recentSnapshot`. Nil outside a session produces an empty capture.
  var recentWindow: (() -> [[String: Any?]])?

  /// `VESC Fault Collection` App Setting, mirrored from `VescFaultCoordinator` by the session
  /// controller. Turning it off stops new capture rows. Existing captures stay readable.
  private var collectionEnabled = true

  private let store: VescFaultCaptureStoring
  private let lock = NSLock()
  /// Serial writer: durable writes leave the BLE callback thread. Mirrors Android's single
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

  /// Copy and persist recent decoded telemetry at fault detection.
  func capturePast(occurrenceId: String, boardId: String, openedAtMs: Int64) {
    lock.lock()
    let enabled = collectionEnabled
    lock.unlock()
    guard enabled else { return }
    let startedAtMs = openedAtMs - Self.preRollMs
    let samples = (recentWindow?() ?? [])
      .compactMap(VescFaultCaptureSample.fromLiveSample)
      .filter { $0.capturedAtMs >= startedAtMs && $0.capturedAtMs <= openedAtMs }
    let capture = VescFaultCapture(
      occurrenceId: occurrenceId,
      boardId: boardId,
      startedAtMs: startedAtMs,
      openedAtMs: openedAtMs,
      sampleCount: samples.count
    )
    persist { [store] in
      store.upsertCapture(capture)
      if !samples.isEmpty { store.appendSamples(occurrenceId, samples) }
    }
  }

  /// Mirror the `VESC Fault Collection` App Setting. Stored evidence is never deleted by it.
  func setCollectionEnabled(_ enabled: Bool) {
    lock.lock()
    collectionEnabled = enabled
    lock.unlock()
  }

  func capture(_ occurrenceId: String) -> VescFaultCapture? { store.getCapture(occurrenceId) }

  func samples(_ occurrenceId: String) -> [VescFaultCaptureSample] { store.getSamples(occurrenceId) }
}
