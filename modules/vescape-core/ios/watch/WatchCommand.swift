import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt
enum WatchCommandKind {
  static let move: UInt8 = 1
  static let mirrorAwake: UInt8 = 2
  static let lights: UInt8 = 3
  static let tiltLock: UInt8 = 4
  static let tiltCancel: UInt8 = 5
  static let dismissNotice: UInt8 = 6
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WATCH_MIRROR_AWAKE_TIMEOUT_MS`
let watchMirrorAwakeTimeoutMs: Int64 = 45_000

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `wakeHeartbeat`
let watchMirrorAwakeHeartbeatMs: Int64 = 15_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WATCH_MOVE_DEADMAN_MS`
let watchMoveDeadManMs: Int64 = 900

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `MOVE_REPEAT_MS`
let watchMoveRepeatMs: Int64 = 300

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WatchMirrorWakeLevel`
enum WatchMirrorWakeLevel: UInt8 {
  case asleep = 0
  case active = 1
  case ambient = 2
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WatchLightsSwitch`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `LightSwitch`
enum WatchLightsSwitch: UInt8 {
  case leds = 0
  case headlight = 1
}

enum WatchCommand: Equatable {
  case move(Int)

  case mirrorAwake(WatchMirrorWakeLevel)

  case lights(WatchLightsSwitch, Bool)

  case tiltLock(Int)

  case tiltCancel

  case dismissNotice(id: Int, rev: Int)
}

enum WatchCommandCodec {
  static func encode(_ command: WatchCommand) -> Data {
    switch command {
    case .move(let direction):
      return Data([WatchCommandKind.move, UInt8(bitPattern: Int8(clampWatchMoveDirection(direction)))])
    case .mirrorAwake(let level):
      return Data([WatchCommandKind.mirrorAwake, level.rawValue])
    case .lights(let `switch`, let on):
      return Data([WatchCommandKind.lights, (`switch`.rawValue << 1) | (on ? 1 : 0)])
    case .tiltLock(let value):
      return Data([WatchCommandKind.tiltLock, UInt8(min(max(value, 0), 255))])
    case .tiltCancel:
      return Data([WatchCommandKind.tiltCancel, 0])
    case .dismissNotice(let id, let rev):
      return Data([WatchCommandKind.dismissNotice, UInt8(min(max(id, 0), 255)), UInt8(min(max(rev, 0), 255))])
    }
  }

  static func decode(_ bytes: Data) -> WatchCommand? {
    guard bytes.count >= 2 else { return nil }
    let kind = bytes[bytes.startIndex]
    let value = bytes[bytes.startIndex + 1]
    switch kind {
    case WatchCommandKind.move:
      return .move(clampWatchMoveDirection(Int(Int8(bitPattern: value))))
    case WatchCommandKind.mirrorAwake:
      return WatchMirrorWakeLevel(rawValue: value).map(WatchCommand.mirrorAwake)
    case WatchCommandKind.lights:
      guard value & ~0x3 == 0, let `switch` = WatchLightsSwitch(rawValue: (value >> 1) & 0x1) else { return nil }
      return .lights(`switch`, value & 0x1 == 1)
    case WatchCommandKind.tiltLock:
      return .tiltLock(Int(value))
    case WatchCommandKind.tiltCancel:
      return .tiltCancel
    case WatchCommandKind.dismissNotice:
      guard bytes.count >= 3 else { return nil }
      return .dismissNotice(id: Int(value), rev: Int(bytes[bytes.startIndex + 2]))
    default:
      return nil
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WatchCommandDecoder`
func clampWatchMoveDirection(_ direction: Int) -> Int {
  min(max(direction, -1), 1)
}
