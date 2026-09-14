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
  /// Board Move. Wired by #487; the constant is reserved here so the wire numbering cannot drift.
  static let move: UInt8 = 1
  static let mirrorAwake: UInt8 = 2
  /// Lights. Wired by #488; reserved for the same reason as `move`.
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

/// A decoded wrist command.
enum WatchCommand: Equatable {
  /// The Mirror reporting how awake it is; re-sent on a heartbeat so its absence is meaningful.
  case mirrorAwake(WatchMirrorWakeLevel)
}

/// Pure bytes <-> command. The encoder is the wrist's, the decoder the phone's; they live together
/// because a wire format split across two files is a wire format that drifts.
enum WatchCommandCodec {
  static func encode(_ command: WatchCommand) -> Data {
    switch command {
    case .mirrorAwake(let level): return Data([WatchCommandKind.mirrorAwake, level.rawValue])
    }
  }

  /// Nil for a short buffer, an unknown kind, or an unknown value of a known kind. Move and Lights
  /// are reserved kinds with no phone-side handler yet (#487, #488), so they decode to nil today —
  /// deliberately the same "ignored" outcome as a kind this build has never heard of.
  static func decode(_ bytes: Data) -> WatchCommand? {
    guard bytes.count >= 2 else { return nil }
    let kind = bytes[bytes.startIndex]
    let value = bytes[bytes.startIndex + 1]
    guard kind == WatchCommandKind.mirrorAwake else { return nil }
    return WatchMirrorWakeLevel(rawValue: value).map(WatchCommand.mirrorAwake)
  }
}
