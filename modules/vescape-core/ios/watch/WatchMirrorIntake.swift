import Foundation

/// Wrist projection of the phone's channels. Live delivery and replay submit the same wire
/// payloads; transport scheduling, commands and diagnostics stay in their adapters.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMirrorIntake.kt
struct WatchMirrorIntake {
  private(set) var mirror = MirrorStateReducer.reduce(frame: nil, lastFrameAtMs: nil, nowMs: 0)
  private(set) var route: WatchRoute?
  private(set) var routeStatus: WatchRouteStatus?
  private(set) var settings: WatchSettings = .wristDefaults
  private(set) var weather: WatchWeather?
  private(set) var board = WatchBoardLights()
  private(set) var groupRide: WatchGroupRide?
  private(set) var lastFrameAtMs: Int64?
  private var latestFrame: WatchFrame?
  private var frameGapMs: Int64?
  private var lastGroupRideAtMs: Int64?

  @discardableResult
  mutating func acceptTelemetry(_ bytes: Data, receivedAtMs: Int64, appliedAtMs: Int64) -> Bool {
    guard let frame = WatchFrameBuilder.decode(bytes) else { return false }
    if let previous = lastFrameAtMs { frameGapMs = max(receivedAtMs - previous, 0) }
    latestFrame = frame
    lastFrameAtMs = receivedAtMs
    refresh(nowMs: appliedAtMs)
    return true
  }

  mutating func acceptGroupRide(_ bytes: Data, receivedAtMs: Int64) {
    guard let frame = GroupRideFrameCodec.decode(bytes) else { return }
    groupRide = WatchGroupRide.accepting(frame, previous: groupRide)
    lastGroupRideAtMs = receivedAtMs
  }

  mutating func acceptRouteStatus(_ bytes: Data?) {
    guard let bytes else { routeStatus = nil; return }
    if let status = WatchRouteStatusCodec.decode(bytes) { routeStatus = status }
  }

  /// Invalid cold values replace old values; invalid hot messages are dropped above.
  mutating func acceptRoute(_ bytes: Data?) { route = bytes.flatMap(WatchRouteCodec.decode) }
  mutating func acceptSettings(_ payload: [String: Any]?) { settings = WatchSettings.decode(payload ?? [:]) }
  mutating func acceptWeather(_ payload: [String: Any]?) { weather = WatchWeather.decode(payload) }
  mutating func acceptBoard(_ payload: [String: Any]?) {
    board = WatchBoardLights.decode(payload)
  }

  /// A complete snapshot on startup/reconnect resets channels absent from the phone. Per-channel
  /// replay updates use the same setters without accidentally clearing unrelated cold channels.
  mutating func restoreColdState(_ context: [String: Any]) {
    route = WatchRoute.decode(context: context)
    acceptSettings(context[watchSettingsChannel] as? [String: Any])
    acceptWeather(context[watchWeatherChannel] as? [String: Any])
    acceptBoard(context[watchBoardChannel] as? [String: Any])
  }

  mutating func refresh(nowMs: Int64) {
    mirror = MirrorStateReducer.reduce(
      frame: latestFrame, lastFrameAtMs: lastFrameAtMs, nowMs: nowMs,
      timeoutMs: MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: frameGapMs)
    )
    if mirror.status == .disconnected { routeStatus = nil }
    if let at = lastGroupRideAtMs, nowMs - at > WatchGroupRide.timeoutMs {
      groupRide = nil
      lastGroupRideAtMs = nil
    }
  }
}
