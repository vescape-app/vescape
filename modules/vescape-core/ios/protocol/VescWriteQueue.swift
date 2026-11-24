import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescWriteQueue.kt
/// @platform-diff CoreBluetooth cannot refuse to start a write, so there is no retry of a refused
/// write here; Android's `writeCharacteristic` can refuse, and its queue puts the write back.
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

  private struct NormalEntry {
    let bytes: [UInt8]
    let tag: String?
  }

  private struct PendingRemoteInput {
    let bytes: [UInt8]
    let urgent: Bool
  }

  private let lock = NSLock()
  private var normal: [NormalEntry] = []
  private var pendingRemoteInput: PendingRemoteInput?
  private var inFlight: Write?
  private var preferRemoteInput = false

  static let defaultChunkLimit = 20

  private var frame: Write?
  private var frameTag: String?
  private var frameOffset = 0
  private var chunkLimit = VescWriteQueue.defaultChunkLimit

  func setChunkLimit(_ bytes: Int) {
    lock.lock()
    defer { lock.unlock() }
    chunkLimit = max(bytes, VescWriteQueue.defaultChunkLimit)
  }

  func enqueueNormal(_ bytes: [UInt8], tag: String? = nil) {
    lock.lock()
    defer { lock.unlock() }
    normal.append(NormalEntry(bytes: bytes, tag: tag))
  }

  @discardableResult
  func dropNormal(tag: String) -> Int {
    lock.lock()
    defer { lock.unlock() }
    let before = normal.count
    normal.removeAll { $0.tag == tag }
    var dropped = before - normal.count
    if frameTag == tag {
      frame = nil
      frameTag = nil
      frameOffset = 0
      dropped += 1
    }
    return dropped
  }

  func replaceRemoteInput(_ bytes: [UInt8], urgent: Bool = false) {
    lock.lock()
    defer { lock.unlock() }
    if !urgent, pendingRemoteInput?.urgent == true { return }
    pendingRemoteInput = PendingRemoteInput(bytes: bytes, urgent: urgent)
  }

  func startNext() -> Write? {
    lock.lock()
    defer { lock.unlock() }
    if inFlight != nil { return nil }
    guard let current = frame ?? nextFrame() else { return nil }
    let frameBytes = current.bytes
    let end = min(frameOffset + chunkLimit, frameBytes.count)
    let bytes = frameOffset == 0 && end == frameBytes.count ? frameBytes : Array(frameBytes[frameOffset..<end])
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
      frameTag = nil
      next = .remoteInput(bytes: remoteInput.bytes)
    } else {
      if normal.isEmpty { return nil }
      preferRemoteInput = true
      let entry = normal.removeFirst()
      frameTag = entry.tag
      next = .normal(bytes: entry.bytes)
    }
    frame = next
    frameOffset = 0
    return next
  }

  @discardableResult
  func completeInFlight(failed: Bool = false) -> Write? {
    lock.lock()
    defer { lock.unlock() }
    let completed = inFlight
    inFlight = nil
    if failed || frameOffset >= (frame?.bytes.count ?? 0) {
      frame = nil
      frameTag = nil
    }
    return completed
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    normal.removeAll()
    pendingRemoteInput = nil
    inFlight = nil
    preferRemoteInput = false
    frame = nil
    frameTag = nil
    frameOffset = 0
    chunkLimit = VescWriteQueue.defaultChunkLimit
  }
}
