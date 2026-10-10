import Foundation

/// Turns a wrist light edit into the same `setBoardLights` write the phone UI makes (ADR-0033), so
/// a wrist tap and a phone tap are literally the same action and land in the same echo handling —
/// including the legacy config rebase, which the wrist therefore needs to know nothing about.
///
/// The wrist sends one switch; the write states both. Composing the pair here rather than on the
/// wrist is what keeps a slightly stale board push from reverting a switch the phone changed a
/// moment earlier, and it mirrors `useBoardLights`, which also refuses to write until both values
/// are known. Edits that arrive before the board echoes compose on top of each other, so a quick
/// second tap cannot undo the first.
///
/// No dead-man, unlike Board Move: a light write is idempotent state, not motor output, so a lost
/// message leaves the board exactly where it was and nothing has to be undone.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchLightsRelay.kt
/// @platform-diff The Android relay owns the hop onto its scheduler because Wear commands arrive on
///   a binder thread. `WCSession` hands commands to its delegate on its own queue and the caller
///   already posts to the controller's scheduler before this is touched, so the relay itself is
///   synchronous — and therefore testable without a scheduler double.
final class WatchLightsRelay {
  private let currentLights: () -> BoardLightsState?
  private let setLights: (Bool, Bool) -> Bool
  private let record: (String, [String: Any?]) -> Void

  /// The pair last written from a wrist edit, and the phone truth it was composed against.
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
    // A second edit before the first echo must build on the first, or it states the pre-edit value
    // of the other switch and reverts it. The moment the phone's own truth moves — echo, config
    // seed, session end — that truth wins again and the pending pair is forgotten, which is what
    // keeps a wrist edit from reverting a switch the phone changed meanwhile.
    let base = (pending != nil && truth == pendingBase) ? pending : truth
    guard let next = composeBoardLights(base, `switch`, on) else {
      // The board has never said what its lights are, so there is no second value to state.
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

/// Apply a wrist edit to the phone's own light truth. Nil `current` means this session has never
/// heard the board — with only one of the two values in hand, a write would assert a guess about
/// the other, so there is nothing honest to send.
///
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
