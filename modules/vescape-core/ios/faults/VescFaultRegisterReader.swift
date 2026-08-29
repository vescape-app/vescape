import Foundation

/// The bytes one terminal read collected, plus the honest statement about whether it finished.
struct VescFaultRegisterRead {
  let reason: VescFaultRegisterReason
  let status: VescFaultRegisterStatus
  let raw: Data
  let text: String
}

/// Collects the `COMM_PRINT` frames answering one `faults` request and decides, on a bounded policy,
/// when the read is over.
///
/// The VESC protocol has **no** completion frame for terminal output, so there are exactly two ways
/// a read can end and both are represented honestly:
///
/// - **idle boundary** — at least one frame arrived and the controller then stayed quiet for
///   `idleBoundaryMs`. The output settled: `.complete`.
/// - **hard bound** — `hardBoundMs` elapsed since the request. Whatever arrived (possibly nothing)
///   is kept as `.incomplete`. Completion is never synthesized on a timeout, because "nothing
///   arrived" and "the register is empty" are different facts.
///
/// Pure and clock-driven: the Board Session ticks `poll`, nothing here schedules or sends.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegisterReader.kt
final class VescFaultRegisterReader {
  /// Quiet time after the last frame that counts as "the controller finished answering".
  static let idleBoundaryMs: Int64 = 500

  /// Upper bound on one read, no matter what the link does.
  static let hardBoundMs: Int64 = 4_000

  /// How often the Board Session should tick `poll` while a read is in flight.
  static let tickSeconds: TimeInterval = 0.1

  let boardId: String
  let reason: VescFaultRegisterReason

  private let startedAtMs: Int64
  private var buffer = Data()
  private var lastChunkAtMs: Int64?
  private var finished = false

  init(boardId: String, reason: VescFaultRegisterReason, startedAtMs: Int64) {
    self.boardId = boardId
    self.reason = reason
    self.startedAtMs = startedAtMs
  }

  /// True once `poll` has produced the read's result; further chunks are ignored.
  var isFinished: Bool { finished }

  /// Bytes of one `COMM_PRINT` payload, command byte (and any CAN wrapper) already stripped.
  func onPrintChunk(_ bytes: [UInt8], atMs: Int64) {
    guard !finished, !bytes.isEmpty else { return }
    buffer.append(contentsOf: bytes)
    lastChunkAtMs = atMs
  }

  /// - Returns: the finished read, or nil while the completion policy says to keep waiting.
  func poll(_ nowMs: Int64) -> VescFaultRegisterRead? {
    guard !finished else { return nil }
    let settled = lastChunkAtMs.map { nowMs - $0 >= Self.idleBoundaryMs } ?? false
    let expired = nowMs - startedAtMs >= Self.hardBoundMs
    guard settled || expired else { return nil }
    finished = true
    // A settled read is complete even if the hard bound landed in the same tick: the controller did
    // go quiet, which is the only completion signal the protocol offers.
    return read(status: settled ? .complete : .incomplete)
  }

  /// The Board Session ended before the policy resolved. Keeps the partial bytes as evidence and
  /// says so — this can never become a complete read.
  func finishIncomplete() -> VescFaultRegisterRead? {
    guard !finished else { return nil }
    finished = true
    return read(status: .incomplete)
  }

  private func read(status: VescFaultRegisterStatus) -> VescFaultRegisterRead {
    VescFaultRegisterRead(
      reason: reason,
      status: status,
      raw: buffer,
      text: String(decoding: buffer, as: UTF8.self)
    )
  }
}
