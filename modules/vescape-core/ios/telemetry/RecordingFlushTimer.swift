import Foundation

/// One deadline from the first buffered sample, never postponed by later samples. Access only on
/// the recording queue. Threshold/manual flushes cancel it before starting another batch.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `scheduleFlushLocked`
internal final class RecordingFlushTimer {
  private let queue: DispatchQueue
  private let delay: TimeInterval
  private var work: DispatchWorkItem?

  init(queue: DispatchQueue, delay: TimeInterval = 5) {
    self.queue = queue
    self.delay = delay
  }

  func schedule(_ flush: @escaping () -> Void) {
    guard work == nil else { return }
    let item = DispatchWorkItem { [weak self] in
      self?.work = nil
      flush()
    }
    work = item
    queue.asyncAfter(deadline: .now() + delay, execute: item)
  }

  func cancel() {
    work?.cancel()
    work = nil
  }
}
