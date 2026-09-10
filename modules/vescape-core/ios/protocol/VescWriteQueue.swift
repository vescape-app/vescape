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

  /// Start next write, or `nil` while another write is active or the queue is empty.
  func startNext() -> Write? {
    lock.lock()
    defer { lock.unlock() }
    if inFlight != nil { return nil }

    if let remoteInput = pendingRemoteInput,
      remoteInput.urgent || normal.isEmpty || preferRemoteInput
    {
      pendingRemoteInput = nil
      preferRemoteInput = false
      let write = Write.remoteInput(bytes: remoteInput.bytes)
      inFlight = write
      return write
    }

    if normal.isEmpty { return nil }
    let next = normal.removeFirst()
    preferRemoteInput = true
    let write = Write.normal(bytes: next)
    inFlight = write
    return write
  }

  /// Complete the current write after its GATT callback.
  @discardableResult
  func completeInFlight() -> Write? {
    lock.lock()
    defer { lock.unlock() }
    let completed = inFlight
    inFlight = nil
    return completed
  }

  /// Put a write that CoreBluetooth refused to start back into the queue. A newer remote input
  /// value wins over the refused one.
  func retryInFlight() {
    lock.lock()
    defer { lock.unlock() }
    switch inFlight {
    case .normal(let bytes):
      normal.insert(bytes, at: 0)
    case .remoteInput(let bytes):
      if pendingRemoteInput == nil {
        pendingRemoteInput = PendingRemoteInput(bytes: bytes, urgent: false)
      }
    case nil:
      break
    }
    inFlight = nil
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    normal.removeAll()
    pendingRemoteInput = nil
    inFlight = nil
    preferRemoteInput = false
  }
}
