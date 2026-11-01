import Foundation

/// Serializes BLE writes while keeping transient remote input (tilt, Board Move) replaceable.
///
/// Normal commands preserve FIFO ordering. Remote input has at most one pending command: a newer
/// value replaces an older one. Ordinary remote commands and normal traffic alternate when both are
/// pending; emergency neutral always dispatches first once the current write completes.
///
/// Without the replaceable slot a held control at its repeat cadence appends a write per tick, which
/// outruns the link and leaves the board executing values seconds behind the finger — and leaves the
/// neutral that ends the gesture stuck behind that backlog.
///
/// A frame larger than the chunk limit goes out as consecutive chunks. Some BLE modules hang on the
/// GATT long write the OS would otherwise use (#620). No other write runs between chunks of one
/// frame: extra bytes mid-frame corrupt the VESC byte stream. So an urgent neutral waits for the
/// frame in flight to finish, at most one frame of chunks (about 14 writes for a 280-byte tune frame
/// at MTU 23).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescWriteQueue.kt
internal final class VescWriteQueue {
  enum Write {
    case normal(bytes: [UInt8])
    case remoteInput(bytes: [UInt8])

    var bytes: [UInt8] {
      switch self {
      case .normal(let bytes), .remoteInput(let bytes): return bytes
      }
    }
  }

  private struct PendingRemoteInput {
    let bytes: [UInt8]
    let urgent: Bool
  }

  private let lock = NSLock()
  private var normal: [[UInt8]] = []
  private var pendingRemoteInput: PendingRemoteInput?
  private var inFlight: Write?
  private var preferRemoteInput = false

  /// Payload of one write at the default ATT MTU of 23.
  static let defaultChunkLimit = 20

  /// Frame whose chunks are being sent, and the offset of its next unsent byte.
  private var frame: Write?
  private var frameOffset = 0
  private var inFlightOffset = 0
  private var chunkLimit = VescWriteQueue.defaultChunkLimit

  /// Largest single write the link accepts (ATT MTU - 3). Applies from the next chunk on.
  func setChunkLimit(_ bytes: Int) {
    lock.lock()
    defer { lock.unlock() }
    chunkLimit = max(bytes, VescWriteQueue.defaultChunkLimit)
  }

  func enqueueNormal(_ bytes: [UInt8]) {
    lock.lock()
    defer { lock.unlock() }
    normal.append(bytes)
  }

  /// Replace any unsent remote input with `bytes`.
  ///
  /// An unsent urgent write survives: it is a neutral/stop, and Remote Tilt and Board Move share
  /// this one slot, so a routine tick from the other feature must not swallow a stop that has not
  /// reached the board yet. A newer urgent write still replaces an older one.
  func replaceRemoteInput(_ bytes: [UInt8], urgent: Bool = false) {
    lock.lock()
    defer { lock.unlock() }
    if !urgent, pendingRemoteInput?.urgent == true { return }
    pendingRemoteInput = PendingRemoteInput(bytes: bytes, urgent: urgent)
  }

  /// Start next chunk, or `nil` while another write is active or the queue is empty. The rest of a
  /// partly sent frame always goes before any other write.
  func startNext() -> Write? {
    lock.lock()
    defer { lock.unlock() }
    if inFlight != nil { return nil }
    guard let current = frame ?? nextFrame() else { return nil }
    let frameBytes = current.bytes
    let end = min(frameOffset + chunkLimit, frameBytes.count)
    let bytes = frameOffset == 0 && end == frameBytes.count ? frameBytes : Array(frameBytes[frameOffset..<end])
    inFlightOffset = frameOffset
    frameOffset = end
    let write: Write
    switch current {
    case .normal: write = .normal(bytes: bytes)
    case .remoteInput: write = .remoteInput(bytes: bytes)
    }
    inFlight = write
    return write
  }

  private func nextFrame() -> Write? {
    let next: Write
    if let remoteInput = pendingRemoteInput,
      remoteInput.urgent || normal.isEmpty || preferRemoteInput
    {
      pendingRemoteInput = nil
      preferRemoteInput = false
      next = .remoteInput(bytes: remoteInput.bytes)
    } else {
      if normal.isEmpty { return nil }
      preferRemoteInput = true
      next = .normal(bytes: normal.removeFirst())
    }
    frame = next
    frameOffset = 0
    return next
  }

  /// Complete the current chunk after its GATT callback.
  @discardableResult
  func completeInFlight() -> Write? {
    lock.lock()
    defer { lock.unlock() }
    let completed = inFlight
    inFlight = nil
    if frameOffset >= (frame?.bytes.count ?? 0) { frame = nil }
    return completed
  }

  /// Put a chunk that CoreBluetooth refused to start back into the queue. A partly sent frame
  /// resumes from the refused chunk. A frame with nothing sent yet goes back whole, and a newer
  /// remote input value wins over a refused one.
  func retryInFlight() {
    lock.lock()
    defer { lock.unlock() }
    guard inFlight != nil else { return }
    inFlight = nil
    if inFlightOffset > 0 {
      frameOffset = inFlightOffset
      return
    }
    switch frame {
    case .normal(let bytes):
      normal.insert(bytes, at: 0)
    case .remoteInput(let bytes):
      if pendingRemoteInput == nil {
        pendingRemoteInput = PendingRemoteInput(bytes: bytes, urgent: false)
      }
    case nil:
      break
    }
    frame = nil
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    normal.removeAll()
    pendingRemoteInput = nil
    inFlight = nil
    preferRemoteInput = false
    frame = nil
    frameOffset = 0
    inFlightOffset = 0
  }
}
