import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMirrorIntake.kt
struct WatchMirrorIntake {
  private(set) var mirror = MirrorStateReducer.reduce(frame: nil, lastFrameAtMs: nil, nowMs: 0)
  private(set) var route: WatchRoute?
  private(set) var routeStatus: WatchRouteStatus?
  private(set) var settings: WatchSettings = .wristDefaults
  private(set) var weather: WatchWeather?
  private(set) var board = WatchBoardLights()
  private(set) var groupRide: WatchGroupRide?
  /// @platform-diff Wear OS has no list: its held tiles are its `/map-tile` Data Layer items.
  private(set) var mapTiles: WatchMapTileList?
  private(set) var lastFrameAtMs: Int64?
  private var rideNotices = WatchRideNotices()
  var rideNoticeCard: RideNoticeFrameItem? { rideNotices.card }
  var wallClockMs: () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
  private var latestFrame: WatchFrame?
  private var recentGapsMs: [Int64] = []
  private var lastGroupRideAtMs: Int64?

  @discardableResult
  mutating func acceptTelemetry(_ bytes: Data, receivedAtMs: Int64, appliedAtMs: Int64) -> Bool {
    guard let frame = WatchFrameBuilder.decode(bytes) else { return false }
    if let previous = lastFrameAtMs, receivedAtMs - previous <= MirrorStateReducer.maxTimeoutMs {
      recentGapsMs.append(max(receivedAtMs - previous, 0))
      if recentGapsMs.count > MirrorStateReducer.cadenceWindowGaps { recentGapsMs.removeFirst() }
    }
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

  mutating func acceptRoute(_ bytes: Data?) { route = bytes.flatMap(WatchRouteCodec.decode) }
  mutating func acceptSettings(_ payload: [String: Any]?) { settings = WatchSettings.decode(payload ?? [:]) }
  mutating func acceptWeather(_ payload: [String: Any]?) { weather = WatchWeather.decode(payload) }
  mutating func acceptBoard(_ payload: [String: Any]?) {
    board = WatchBoardLights.decode(payload)
  }

  /// @platform-diff The Application Context channel is never deleted, so there is no Wear OS-style
  ///   deletion path.
  @discardableResult
  mutating func acceptRideNotices(_ bytes: Data) -> Bool {
    guard let frame = RideNoticeFrameCodec.decode(bytes) else { return false }
    return rideNotices.accept(frame, nowMs: wallClockMs())
  }

  mutating func hideRideNotice(id: Int, rev: Int) { rideNotices.hide(id: id, rev: rev) }

  @discardableResult
  mutating func restoreColdState(_ context: [String: Any]) -> Bool {
    route = WatchRoute.decode(context: context)
    acceptSettings(context[watchSettingsChannel] as? [String: Any])
    acceptWeather(context[watchWeatherChannel] as? [String: Any])
    acceptBoard(context[watchBoardChannel] as? [String: Any])
    if let list = WatchMapTileList.decode(context[watchMapTilesChannel] as? [String: Any]) { mapTiles = list }
    guard let rideNotices = (context[watchRideNoticesChannel] as? [String: Any])?[watchRideNoticesFrameKey] as? Data
    else { return false }
    return acceptRideNotices(rideNotices)
  }

  mutating func refresh(nowMs: Int64) {
    mirror = MirrorStateReducer.reduce(
      frame: latestFrame, lastFrameAtMs: lastFrameAtMs, nowMs: nowMs,
      timeoutMs: MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: recentGapsMs.max())
    )
    if mirror.status == .disconnected { routeStatus = nil }
    rideNotices.prune(nowMs: wallClockMs())
    if let at = lastGroupRideAtMs, nowMs - at > WatchGroupRide.timeoutMs {
      groupRide = nil
      lastGroupRideAtMs = nil
    }
  }
}
