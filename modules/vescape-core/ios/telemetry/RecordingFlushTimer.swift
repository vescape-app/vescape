import Foundation

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
