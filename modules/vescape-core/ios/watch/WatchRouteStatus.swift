import Foundation

/// Live route state, separate from telemetry so older watch builds keep decoding their frames.
/// Compiled by both the iPhone and wrist. Version, phase, uint32 route fingerprint (LE).
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRouteStatus.kt
let watchRouteStatusMessageKey = "route-status"

enum WatchRoutePhase: UInt8 { case idle = 0, computing = 1, ready = 2, failed = 3 }
enum WatchRouteNotice { case computing, receiving, location, failed }

struct WatchRouteStatus: Equatable {
  var phase: WatchRoutePhase
  var routeId: UInt32 = 0

  func notice(receivedRouteId: UInt32?, hasPosition: Bool) -> WatchRouteNotice? {
    if phase == .computing { return .computing }
    if phase == .failed { return .failed }
    guard phase == .ready else { return nil }
    if routeId == 0 || receivedRouteId != routeId { return .receiving }
    return hasPosition ? nil : .location
  }

  func canDraw(receivedRouteId: UInt32?) -> Bool {
    phase == .ready && routeId != 0 && receivedRouteId == routeId
  }
}

enum WatchRouteStatusCodec {
  static func encode(_ status: WatchRouteStatus) -> Data {
    var data = Data([1, status.phase.rawValue])
    withUnsafeBytes(of: status.routeId.littleEndian) { data.append(contentsOf: $0) }
    return data
  }

  static func decode(_ data: Data) -> WatchRouteStatus? {
    let bytes = [UInt8](data)
    guard bytes.count == 6, bytes[0] == 1, let phase = WatchRoutePhase(rawValue: bytes[1]) else { return nil }
    let id = UInt32(bytes[2]) | UInt32(bytes[3]) << 8 | UInt32(bytes[4]) << 16 | UInt32(bytes[5]) << 24
    return WatchRouteStatus(phase: phase, routeId: id)
  }

  /// FNV-1a of the exact transferred bytes. Zero is reserved for no route.
  static func routeId(_ data: Data) -> UInt32 {
    var hash: UInt32 = 2166136261
    for byte in data { hash = (hash ^ UInt32(byte)) &* 16777619 }
    return hash == 0 ? 1 : hash
  }
}
