import Foundation

/// Collects one manual VESC `faults` terminal response. Nothing is persisted or parsed.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultLogReader.kt
final class VescFaultLogReader {
  static let tickSeconds = 0.1
  private static let idleBoundaryMs: Int64 = 500
  private static let hardBoundMs: Int64 = 4_000

  let onSuccess: (String) -> Void
  let onError: (String, String) -> Void
  private let startedAtMs: Int64
  private var bytes: [UInt8] = []
  private var lastChunkAtMs: Int64?
  private var finished = false

  init(
    startedAtMs: Int64,
    onSuccess: @escaping (String) -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    self.startedAtMs = startedAtMs
    self.onSuccess = onSuccess
    self.onError = onError
  }

  func onPrintChunk(_ chunk: [UInt8], atMs: Int64) {
    guard !finished, !chunk.isEmpty else { return }
    bytes.append(contentsOf: chunk)
    lastChunkAtMs = atMs
  }

  func poll(_ nowMs: Int64) -> Bool {
    if finished { return true }
    if let lastChunkAtMs, nowMs - lastChunkAtMs >= Self.idleBoundaryMs {
      finished = true
      onSuccess(String(decoding: bytes, as: UTF8.self))
      return true
    }
    guard nowMs - startedAtMs >= Self.hardBoundMs else { return false }
    finished = true
    onError("VESC_FAULT_LOG_TIMEOUT", "Controller fault log did not finish")
    return true
  }

  func cancel() {
    guard !finished else { return }
    finished = true
    onError("VESC_FAULT_LOG_DISCONNECTED", "Board disconnected while reading controller fault log")
  }
}
