import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseReplacementFence.kt `DatabaseReplacementFence`
final class DatabaseReplacementFence {
  static let process = DatabaseReplacementFence()

  private let workLock = NSLock()
  private let generationLock = NSLock()
  private var generation: Int64 = 0

  func ticket() -> Int64 {
    generationLock.lock()
    defer { generationLock.unlock() }
    return generation
  }

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
