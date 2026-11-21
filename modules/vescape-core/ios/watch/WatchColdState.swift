import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettingsPusher.kt
/// @platform-diff Android gets one Data Layer path per channel and a per-path last-value-wins.
///   watchOS has a single Application Context, so the channels share one dictionary and are merged
///   rather than published independently. There is no `setUrgent` equivalent and none is needed:
///   `updateApplicationContext` already replaces any undelivered value.
enum WatchColdStateError: Error {
  case sessionNotActivated
}

final class WatchColdState {
  private let context: () -> [String: Any]
  private let write: ([String: Any]) throws -> Void
  private let record: (String, [String: Any?]) -> Void

  private var pushed: [String: NSDictionary] = [:]

  private var desired: [String: NSDictionary] = [:]

  var onDelivered: ((String) -> Void)?
  var onFailed: ((String) -> Void)?

  init(
    context: @escaping () -> [String: Any],
    write: @escaping ([String: Any]) throws -> Void,
    record: @escaping (String, [String: Any?]) -> Void
  ) {
    self.context = context
    self.write = write
    self.record = record
  }

  func put(channel: String, payload: [String: Any]) {
    let boxed = payload as NSDictionary
    if desired[channel] == boxed, pushed[channel] == boxed { return }
    desired[channel] = boxed
    send(channel: channel, payload: payload)
  }

  func flush() {
    for (channel, payload) in desired where pushed[channel] != payload {
      guard let payload = payload as? [String: Any] else { continue }
      send(channel: channel, payload: payload)
    }
  }

  private func send(channel: String, payload: [String: Any]) {
    var merged = context()
    merged[channel] = payload
    do {
      try write(merged)
      pushed[channel] = payload as NSDictionary
      onDelivered?(channel)
    } catch {
      pushed.removeValue(forKey: channel)
      onFailed?(channel)
      record("watch_cold_state_push_failed", ["channel": channel, "error": error.localizedDescription])
    }
  }
}
