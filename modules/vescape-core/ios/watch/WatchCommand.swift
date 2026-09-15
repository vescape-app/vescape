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
  /// Board Move. Wired by #490; the constant is reserved here so the wire numbering cannot drift.
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
    case .mirrorAwake(let level):
      return Data([WatchCommandKind.mirrorAwake, level.rawValue])
    case .lights(let `switch`, let on):
      // bit0 = the target on/off state, bit1 = which switch.
      return Data([WatchCommandKind.lights, (`switch`.rawValue << 1) | (on ? 1 : 0)])
    }
  }

  /// Nil for a short buffer, an unknown kind, or an unknown value of a known kind. Move is a
  /// reserved kind with no phone-side handler yet (#490), so it decodes to nil today —
  /// deliberately the same "ignored" outcome as a kind this build has never heard of.
  static func decode(_ bytes: Data) -> WatchCommand? {
    guard bytes.count >= 2 else { return nil }
    let kind = bytes[bytes.startIndex]
    let value = bytes[bytes.startIndex + 1]
    switch kind {
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
