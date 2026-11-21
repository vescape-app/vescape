import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchLightsRelay.kt
/// @platform-diff The Android relay owns the hop onto its scheduler because Wear commands arrive on
final class WatchLightsRelay {
  private let currentLights: () -> BoardLightsState?
  private let setLights: (Bool, Bool) -> Bool
  private let record: (String, [String: Any?]) -> Void

  private var pending: BoardLightsState?
  private var pendingBase: BoardLightsState?

  init(
    currentLights: @escaping () -> BoardLightsState?,
    setLights: @escaping (Bool, Bool) -> Bool,
    record: @escaping (String, [String: Any?]) -> Void
  ) {
    self.currentLights = currentLights
    self.setLights = setLights
    self.record = record
  }

  func accept(_ `switch`: WatchLightsSwitch, on: Bool) {
    let truth = currentLights()
    let base = (pending != nil && truth == pendingBase) ? pending : truth
    guard let next = composeBoardLights(base, `switch`, on) else {
      pending = nil
      pendingBase = nil
      record("watch_lights_dropped", ["switch": String(describing: `switch`), "on": on])
      return
    }
    let accepted = setLights(next.enabled, next.headlightsEnabled)
    pending = accepted ? next : nil
    pendingBase = accepted ? truth : nil
    record(
      "watch_lights_set",
      [
        "switch": String(describing: `switch`),
        "on": on,
        "enabled": next.enabled,
        "headlightsEnabled": next.headlightsEnabled,
        "accepted": accepted,
      ]
    )
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchLightsRelay.kt `composeBoardLights`
func composeBoardLights(
  _ current: BoardLightsState?,
  _ `switch`: WatchLightsSwitch,
  _ on: Bool
) -> BoardLightsState? {
  guard let current else { return nil }
  switch `switch` {
  case .leds:
    return BoardLightsState(enabled: on, headlightsEnabled: current.headlightsEnabled)
  case .headlight:
    return BoardLightsState(enabled: current.enabled, headlightsEnabled: on)
  }
}
