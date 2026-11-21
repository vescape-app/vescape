import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt
final class VescFaultCaptureCoordinator {
  static let preRollMs: Int64 = 5_000

  static let shared = VescFaultCaptureCoordinator(store: VescFaultCaptureStore.shared)

  var recentWindow: (() -> [[String: Any?]])?

  private var collectionEnabled = true

  private let store: VescFaultCaptureStoring
  private let lock = NSLock()
  private let writeQueue: DispatchQueue?

  init(store: VescFaultCaptureStoring, writeQueue: DispatchQueue? = DispatchQueue(label: "vescape.faultCapture.write")) {
    self.store = store
    self.writeQueue = writeQueue
  }

  private func persist(_ work: @escaping () -> Void) {
    guard let writeQueue else {
      work()
      return
    }
    writeQueue.async(execute: work)
  }

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

  func setCollectionEnabled(_ enabled: Bool) {
    lock.lock()
    collectionEnabled = enabled
    lock.unlock()
  }

  func capture(_ occurrenceId: String) throws -> VescFaultCapture? { try store.getCapture(occurrenceId) }

  func samples(_ occurrenceId: String) throws -> [VescFaultCaptureSample] { try store.getSamples(occurrenceId) }
}
