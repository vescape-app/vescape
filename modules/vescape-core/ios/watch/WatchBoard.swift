import Foundation

/// Cold-state channel carrying board state the wrist needs but cannot derive from a Watch Frame.
/// It changes on a board echo, a config seed or a trust change — not per tick — and it must outlive
/// the frame stream, which stops the moment the wrist sleeps.
///
/// The payload is a bag rather than spare Watch Frame flag bits, and deliberately so. Lights are
/// tri-state — a key is absent while this Board Session has never heard the board say — and a flags
/// lane has no "unknown" to encode that with. A bag is also forward- and backward-compatible for
/// free: an older wrist ignores keys it does not know, and a newer wrist falls back to unknown for
/// keys an older phone never sends, where a mis-ordered frame lane would silently misread.
///
/// Android publishes the same bag on its own `/board` Data Layer path; the keys are Android's, key
/// for key, so the two wrists read the same switches.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchBoard.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt
let watchBoardChannel = "board"

/// LEDs on/off. Absent means the board has never said, which is not the same as off.
let watchBoardLightsEnabledKey = "lightsEnabled"

/// Headlights on/off. Absent means the board has never said, which is not the same as off.
let watchBoardHeadlightsEnabledKey = "headlightsEnabled"

/// Whether a light write would be accepted at all. Computed phone-side from the same conditions the
/// phone UI and native already use, so the wrist duplicates no policy and stays a dumb surface.
let watchBoardLightsControllableKey = "lightsControllable"

/// Board light state as the phone last reported it.
///
/// Nil is the honest default on both switches: until an echo or a config seed arrives the wrist has
/// no business drawing a switch as on or off, and `false` would render "never said" as the fact
/// "the lights are off".
///
/// Unlike the route channel there is no explicit-clear problem here. The phone always states this
/// channel — a teardown pushes a payload with the two light keys *omitted* and
/// `lightsControllable: false` — so the value that survives a reconnect is the unknown, not the last
/// echo before the board went away.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchBoard.kt `WatchBoard`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt `WatchBoardLights`
struct WatchBoardLights: Equatable {
  var lightsEnabled: Bool?
  var headlightsEnabled: Bool?
  /// False until the phone says otherwise, so a write is never offered on a guess.
  var lightsControllable: Bool

  init(lightsEnabled: Bool? = nil, headlightsEnabled: Bool? = nil, lightsControllable: Bool = false) {
    self.lightsEnabled = lightsEnabled
    self.headlightsEnabled = headlightsEnabled
    self.lightsControllable = lightsControllable
  }

  /// Both switches known, which is what a write needs: `setBoardLights` states the pair, so a
  /// half-known state has no honest second value to send.
  var known: Bool { lightsEnabled != nil && headlightsEnabled != nil }

  /// Nils are *omitted*, never sent as `false`: absence is how the wrist reads "the board has never
  /// said", and a sentinel would render off as fact.
  var payload: [String: Any] {
    var payload: [String: Any] = [watchBoardLightsControllableKey: lightsControllable]
    if let lightsEnabled { payload[watchBoardLightsEnabledKey] = lightsEnabled }
    if let headlightsEnabled { payload[watchBoardHeadlightsEnabledKey] = headlightsEnabled }
    return payload
  }

  /// Decode a pushed payload. An absent channel and an unreadable one both read as unknown, because
  /// the rider cannot act on the difference and neither may be drawn as off.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt `decodeBoardLights`
  static func decode(_ payload: [String: Any]?) -> WatchBoardLights {
    guard let payload else { return WatchBoardLights() }
    return WatchBoardLights(
      lightsEnabled: payload[watchBoardLightsEnabledKey] as? Bool,
      headlightsEnabled: payload[watchBoardHeadlightsEnabledKey] as? Bool,
      // An older phone never sends the key, and no answer must not offer a write.
      lightsControllable: payload[watchBoardLightsControllableKey] as? Bool ?? false
    )
  }

  /// This channel, read out of the merged Application Context.
  static func decode(context: [String: Any]) -> WatchBoardLights {
    decode(context[watchBoardChannel] as? [String: Any])
  }
}
