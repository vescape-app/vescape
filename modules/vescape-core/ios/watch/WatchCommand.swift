import Foundation

/// Wrist -> phone command channel (ADR-0033). The only direction the Watch Mirror ever talks back
/// in: a rider intent or a fact about the wrist itself, never mirrored state. State stays one-way
/// (phone -> wrist) as ADR-0019 set out.
///
/// `sendMessageData`, not the Application Context: a command is worthless once stale, so
/// fire-and-forget with no delivery guarantee is exactly right — a dropped wake tick is covered by
/// the next one, and the phone's own dead-man covers the tick that never comes.
///
/// The payload is two bytes — `[kind, value]` — read leniently so a wrist newer than the phone
/// degrades to "unknown kind, ignored" rather than to a misread command. The byte layout is
/// Android's, verbatim, so the two wrists stay one protocol.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt
enum WatchCommandKind {
  /// Board Move (#490).
  static let move: UInt8 = 1
  static let mirrorAwake: UInt8 = 2
  /// Board lights (#489).
  static let lights: UInt8 = 3
}

/// How long the phone keeps pushing frames at the rider's cadence after the last wrist wake tick.
/// The Mirror re-sends every ``watchMirrorAwakeHeartbeatMs`` while it is on screen, so this is three
/// missed ticks. A wrist that stopped talking is read as asleep and gets the ambient cadence, not
/// the rider's.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WATCH_MIRROR_AWAKE_TIMEOUT_MS`
let watchMirrorAwakeTimeoutMs: Int64 = 45_000

/// How often the wrist re-asserts its wake level while the Mirror is on screen.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `wakeHeartbeat`
let watchMirrorAwakeHeartbeatMs: Int64 = 15_000

/// How long a held Board Move survives without a fresh wrist tick before the phone stops the board.
/// The wrist re-sends every ``watchMoveRepeatMs`` (300 ms) while a half is held, so this is three
/// missed ticks.
///
/// This is the safety property of the whole feature. Press/release alone is not enough: the release
/// is the one message that must not be lost, and it is exactly the message a dropped link eats —
/// a lost release would otherwise leave the phone streaming motor output forever, because the
/// firmware's own ~1 s lapse never fires while the phone keeps talking. Lost release, app exit, a
/// dead watch and a walk out of range are all the same event to the phone: ticks stopped.
///
/// Measured by the phone's own clock from the moment a tick is *received*, never from a timestamp
/// the wrist wrote: the two devices have independent clock domains, and a wrist clock is not
/// something a motor should be gated on.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WATCH_MOVE_DEADMAN_MS`
let watchMoveDeadManMs: Int64 = 900

/// How often the wrist re-states the direction it is holding. A third of ``watchMoveDeadManMs``, so
/// a release lost to a link drop costs the rider under a second of roll rather than an unbounded one.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `MOVE_REPEAT_MS`
let watchMoveRepeatMs: Int64 = 300

/// How awake the wrist is, and therefore how fast frames are worth sending. Wire values — append,
/// never renumber.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WatchMirrorWakeLevel`
enum WatchMirrorWakeLevel: UInt8 {
  /// Mirror stopped, or presumed stopped after ``watchMirrorAwakeTimeoutMs``.
  case asleep = 0
  /// Mirror on screen and interactive. Full cadence.
  case active = 1
  /// Mirror in the Always On state. The wrist redraws rarely, so trickle.
  case ambient = 2
}

/// Which of the board's two light switches a wrist edit names.
///
/// Deliberately *not* the wire mask `buildLightsControlCommand` writes (bit0 = LEDs, bit1 =
/// headlights): there both bits are values, here bit1 is a selector and bit0 is the value. Reusing
/// that bit order would make `0b10` mean "headlights on" on the BLE wire and "headlights off" here.
///
/// Wire values — append, never renumber.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WatchLightsSwitch`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `LightSwitch`
enum WatchLightsSwitch: UInt8 {
  case leds = 0
  case headlight = 1
}

/// A decoded wrist command.
enum WatchCommand: Equatable {
  /// Hold the board rolling in this direction (`-1` back, `0` stop, `1` forward) until the next
  /// tick. A *direction*, never an input value: strength is a phone setting, and a wrist that could
  /// name its own motor output would be a second place that decides how hard the board pushes.
  case move(Int)

  /// The Mirror reporting how awake it is; re-sent on a heartbeat so its absence is meaningful.
  case mirrorAwake(WatchMirrorWakeLevel)

  /// Put one light `switch` into state `on`. An *edit*, not an assertion of both switches: the
  /// phone composes the other value from its own board truth, so a wrist holding a slightly stale
  /// board push cannot revert a switch the phone flipped a moment earlier.
  case lights(WatchLightsSwitch, Bool)
}

/// Pure bytes <-> command. The encoder is the wrist's, the decoder the phone's; they live together
/// because a wire format split across two files is a wire format that drifts.
enum WatchCommandCodec {
  static func encode(_ command: WatchCommand) -> Data {
    switch command {
    case .move(let direction):
      // Two's complement, so `-1` is `0xFF` — the byte Android's signed `Byte` writes.
      return Data([WatchCommandKind.move, UInt8(bitPattern: Int8(clampWatchMoveDirection(direction)))])
    case .mirrorAwake(let level):
      return Data([WatchCommandKind.mirrorAwake, level.rawValue])
    case .lights(let `switch`, let on):
      // bit0 = the target on/off state, bit1 = which switch.
      return Data([WatchCommandKind.lights, (`switch`.rawValue << 1) | (on ? 1 : 0)])
    }
  }

  /// Nil for a short buffer, an unknown kind, or an unknown value of a known kind — deliberately
  /// the same "ignored" outcome as a kind this build has never heard of.
  static func decode(_ bytes: Data) -> WatchCommand? {
    guard bytes.count >= 2 else { return nil }
    let kind = bytes[bytes.startIndex]
    let value = bytes[bytes.startIndex + 1]
    switch kind {
    case WatchCommandKind.move:
      // Clamped rather than rejected: a direction from a future wrist must never become a bigger
      // move than full reverse or full forward, and it must never fail to be readable as a stop.
      return .move(clampWatchMoveDirection(Int(Int8(bitPattern: value))))
    case WatchCommandKind.mirrorAwake:
      return WatchMirrorWakeLevel(rawValue: value).map(WatchCommand.mirrorAwake)
    case WatchCommandKind.lights:
      // Anything above the two defined bits is a wrist newer than this phone, and is dropped rather
      // than read as a switch it is not — the same lenience the unknown-kind branch gives.
      guard value & ~0x3 == 0, let `switch` = WatchLightsSwitch(rawValue: (value >> 1) & 0x1) else { return nil }
      return .lights(`switch`, value & 0x1 == 1)
    default:
      return nil
    }
  }
}

/// `-1` back, `0` stop, `1` forward. The only three values the Move wire has.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WatchCommandDecoder`
func clampWatchMoveDirection(_ direction: Int) -> Int {
  min(max(direction, -1), 1)
}
