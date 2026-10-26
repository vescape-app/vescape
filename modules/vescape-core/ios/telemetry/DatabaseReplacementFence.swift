import Foundation

/// Serializes background database writers against Restore and Clear all. A writer takes a
/// `ticket()` when its work starts; a fence bumps the generation, so a write whose ticket predates a
/// restore or a clear is dropped instead of reaching the replacement database. Weather Observation
/// writes and every Maintenance Job chunk go through it, so a fence waits for at most one write.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseReplacementFence.kt `DatabaseReplacementFence`
final class DatabaseReplacementFence {
  /// The one fence every production writer, Restore and Clear all share.
  static let process = DatabaseReplacementFence()

  /// Serializes writes and fences; held across database work, never taken on the main thread.
  private let workLock = NSLock()
  /// Guards only `generation`, so the main-thread `ticket()` never waits on a write or a restore.
  private let generationLock = NSLock()
  private var generation: Int64 = 0

  func ticket() -> Int64 {
    generationLock.lock()
    defer { generationLock.unlock() }
    return generation
  }

  /// Run `block` only if nothing fenced since `ticket`; nil when the write was fenced off.
  func write<T>(ticket: Int64, _ block: () throws -> T) rethrows -> T? {
    workLock.lock()
    defer { workLock.unlock() }
    guard ticket == self.ticket() else { return nil }
    return try block()
  }

  func fence<T>(_ block: () throws -> T) rethrows -> T {
    workLock.lock()
    defer { workLock.unlock() }
    generationLock.lock()
    generation += 1
    generationLock.unlock()
    return try block()
  }
}
