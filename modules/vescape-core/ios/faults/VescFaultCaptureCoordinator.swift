import Foundation

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
      do {
        try store.saveCapture(capture, samples: samples)
      } catch {
        RecordingStorageFailure.report(operation: "vesc_fault_capture_write", category: "write_failed", error: error)
      }
    }
  }

  /// Mirror the `VESC Fault Collection` App Setting. Stored evidence is never deleted by it.
  func setCollectionEnabled(_ enabled: Bool) {
    lock.lock()
    collectionEnabled = enabled
    lock.unlock()
  }

  func capture(_ occurrenceId: String) throws -> VescFaultCapture? { try store.getCapture(occurrenceId) }

  func samples(_ occurrenceId: String) throws -> [VescFaultCaptureSample] { try store.getSamples(occurrenceId) }
}
