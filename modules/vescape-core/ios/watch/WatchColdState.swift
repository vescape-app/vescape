import Foundation

/// Phone -> wrist cold state (ADR-0019): everything that changes per rider action rather than per
/// tick. Settings today; the route, the weather and the board's lights as their slices land.
///
/// **Why the Application Context and not the other two.** `WCSession` offers three deliveries and
/// they are not interchangeable:
///
/// - `sendMessage`/`sendMessageData` needs the counterpart reachable *now* and drops otherwise. It
///   is right for Watch Frames — a frame is worthless a tick later — and wrong for a setting, which
///   the rider may change with the watch off the wrist and expects to find applied when they put it
///   back on.
/// - `transferUserInfo` queues FIFO and delivers every item. A settings bag changed five times
///   while out of range would arrive five times, in order, and the wrist would animate through the
///   rider's undo history. Nothing here wants a backlog.
/// - `updateApplicationContext` keeps exactly one latest value, delivers it opportunistically, and
///   the system hands it to the watch app at its next launch through `receivedApplicationContext`.
///   Latest-value-wins, survives restart and reconnect, no queue: this is Android's Data Layer
///   semantics, which is why the peer pusher needs no buffering either.
///
/// **Why the channels are merged here.** Android publishes each channel on its own Data Layer path,
/// so `/settings` and `/route` cannot overwrite each other. watchOS has exactly one Application
/// Context per session — a whole-dictionary replace. Writing a channel means reading the current
/// context and putting the channel back into it, or the settings push silently deletes the route.
/// That merge is this type's entire reason to exist, and the reason it is the only writer.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettingsPusher.kt
/// @platform-diff Android gets one Data Layer path per channel and a per-path last-value-wins.
///   watchOS has a single Application Context, so the channels share one dictionary and are merged
///   rather than published independently. There is no `setUrgent` equivalent and none is needed:
///   `updateApplicationContext` already replaces any undelivered value.
enum WatchColdStateError: Error {
  /// The session has not activated yet. Expected exactly once, at cold start, before the first
  /// `activationDidCompleteWith`; anything else is a real failure.
  case sessionNotActivated
}

final class WatchColdState {
  private let context: () -> [String: Any]
  private let write: ([String: Any]) throws -> Void
  private let record: (String, [String: Any?]) -> Void

  /// Last payload known to be on the wrist, per channel. Cleared on failure so the next push
  /// retries rather than trusting a value that never left the phone.
  private var pushed: [String: NSDictionary] = [:]

  /// What the phone wants on the wrist, per channel. Kept apart from `pushed` because the first
  /// push of a cold process races session activation: the settings are known before `WCSession`
  /// will accept them, and a write refused then must not look like a write that landed.
  private var desired: [String: NSDictionary] = [:]

  /// Notified with a channel whose payload is now known to be on the wrist — on the push that
  /// landed, and on the activation retry that landed for a push that did not.
  ///
  /// It exists for the route, which is half a picture: the polyline rides here and the rider's
  /// position on it rides the Watch Frame lanes, measured from the route's origin. A mirror that
  /// moved its origin on *intent* would place the rider against a route the wrist never received,
  /// and unlike a one-frame skew that lasts until the next route change.
  var onDelivered: ((String) -> Void)?

  init(
    context: @escaping () -> [String: Any],
    write: @escaping ([String: Any]) throws -> Void,
    record: @escaping (String, [String: Any?]) -> Void
  ) {
    self.context = context
    self.write = write
    self.record = record
  }

  /// Replace one channel, leaving every other channel and every unrelated key exactly as it is.
  /// A payload equal to the one already on the wrist is not worth a round trip.
  func put(channel: String, payload: [String: Any]) {
    let boxed = payload as NSDictionary
    if desired[channel] == boxed, pushed[channel] == boxed { return }
    desired[channel] = boxed
    send(channel: channel, payload: payload)
  }

  /// Retry every channel the wrist is not known to hold. Called once the session activates, which
  /// is the one moment a refused write is expected rather than a failure.
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
      record("watch_cold_state_push_failed", ["channel": channel, "error": error.localizedDescription])
    }
  }
}
