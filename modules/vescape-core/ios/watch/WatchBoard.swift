import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchBoard.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt
let watchBoardChannel = "board"

let watchBoardLightsEnabledKey = "lightsEnabled"

let watchBoardHeadlightsEnabledKey = "headlightsEnabled"

let watchBoardLightsControllableKey = "lightsControllable"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchBoard.kt `WatchBoard`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt `WatchBoardLights`
struct WatchBoardLights: Equatable {
  var lightsEnabled: Bool?
  var headlightsEnabled: Bool?
  var lightsControllable: Bool

  init(lightsEnabled: Bool? = nil, headlightsEnabled: Bool? = nil, lightsControllable: Bool = false) {
    self.lightsEnabled = lightsEnabled
    self.headlightsEnabled = headlightsEnabled
    self.lightsControllable = lightsControllable
  }

  var known: Bool { lightsEnabled != nil && headlightsEnabled != nil }

  var payload: [String: Any] {
    var payload: [String: Any] = [watchBoardLightsControllableKey: lightsControllable]
    if let lightsEnabled { payload[watchBoardLightsEnabledKey] = lightsEnabled }
    if let headlightsEnabled { payload[watchBoardHeadlightsEnabledKey] = headlightsEnabled }
    return payload
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt `decodeBoardLightsPayload`
  static func decode(_ payload: [String: Any]?) -> WatchBoardLights {
    guard let payload else { return WatchBoardLights() }
    return WatchBoardLights(
      lightsEnabled: payload[watchBoardLightsEnabledKey] as? Bool,
      headlightsEnabled: payload[watchBoardHeadlightsEnabledKey] as? Bool,
      lightsControllable: payload[watchBoardLightsControllableKey] as? Bool ?? false
    )
  }

  static func decode(context: [String: Any]) -> WatchBoardLights {
    decode(context[watchBoardChannel] as? [String: Any])
  }
}
