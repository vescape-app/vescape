import Foundation
import WatchConnectivity

/// Wrist-side end of the Watch Frame path (ADR-0019). Receives the frames `WatchTelemetryPusher`
/// sends from `vescape-core`, reduces them to a Mirror State, and publishes that alongside the
/// lifecycle evidence the port is blocked on: what the session thinks its state is, when the last
/// frame actually landed, and at what rate they are arriving versus being shown.
///
/// Nothing here interprets the ride. Decoding is `WatchFrame.swift` and the fresh/stale/waiting/
/// disconnected decision is `MirrorState.swift`, both the phone's own files symlinked in, so the
/// wrist cannot drift from the encoder or from Android's reducer.
///
/// This is Android's `TelemetryState` plus its `PhoneLinkMonitor`: watchOS needs no separate node
/// and capability poll, because `WCSession` publishes paired, companion-installed and reachable
/// directly and tells the delegate when they change.
///
/// @parity /modules/vescape-core/ios/watch/WatchTelemetryPusher.swift
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TelemetryState.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/PhoneLinkMonitor.kt
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
  /// Rolling window the received/applied rates are measured over. Long enough to survive one missed
  /// push at the slowest cadence worth reporting, short enough to show a stall while it is happening.
  private static let rateWindow: TimeInterval = 5

  /// What the wrist draws: the reduced state, never the raw frame. A view that read `frame`
  /// directly would render a reading the reducer has already declared too old to trust.
  @Published private(set) var mirror = MirrorStateReducer.reduce(frame: nil, lastFrameAtMs: nil, nowMs: 0)
  /// Why there is nothing to draw, while there is nothing to draw.
  @Published private(set) var link: MirrorPhoneLink = .unknown
  /// When the last decodable frame landed, by the watch's own clock. The wrist-down question is
  /// answered by watching this against the wall clock, not by looking at the numbers above it.
  @Published private(set) var lastFrameAt: Date?
  @Published private(set) var activation: WCSessionActivationState = .notActivated
  @Published private(set) var reachable = false
  @Published private(set) var companionInstalled = false
  /// Frames that arrived but did not decode — a phone and a wrist built from different lane counts.
  @Published private(set) var rejected = 0
  /// The rider's phone settings, as last pushed. Cold state: it is read out of the received
  /// Application Context at activation, so a wrist restart or a reconnect finds the current values
  /// already there instead of waiting for the rider to touch a switch again.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt `SettingsState`
  @Published private(set) var settings: WatchSettings = .wristDefaults

  /// The phone's forecast, as last pushed. Cold state on the same channel-merged context as the
  /// settings, so a wrist restart or a reconnect finds the current forecast already there instead
  /// of a blank weather page until the phone next refreshes.
  ///
  /// Held raw, including when it has aged out: `freshWeather(nowMs:)` is what decides whether it is
  /// still worth showing, and the difference between "stale" and "never arrived" is what the radar
  /// and weather pages say to the rider.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WeatherState`
  @Published private(set) var weather: WatchWeather?

  /// The phone's route, as last pushed. Cold state on the same merged context, so a wrist restart
  /// or a reconnect finds the route already drawn instead of a blank nav page until the rider picks
  /// a new destination.
  ///
  /// Nil covers three cases the wrist draws identically — never pushed, explicitly cleared, and a
  /// payload this build cannot read. The one that matters is the middle one: the phone's clear is a
  /// payload and not a removed channel, so the value that survives a reconnect is the clear rather
  /// than the route it replaced.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `RouteState`
  @Published private(set) var route: WatchRoute?

  /// The board's two light switches, as last pushed. Cold state on the same merged context, so a
  /// wrist restart or a reconnect finds the current switches already there rather than a dead Lights
  /// page until the board next echoes.
  ///
  /// Unknown until the phone says otherwise, and unknown again the moment it says the board is gone:
  /// the phone always states this channel, so there is no "absent means the last value still holds".
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt `BoardState`
  @Published private(set) var board = WatchBoardLights()

  /// Bumped on every route change. The wrist's route animators are measured from the route's own
  /// origin, so a replacement route moves the frame underneath them; this is what tells the view to
  /// restart from the new numbers rather than glide across a jump that never happened.
  @Published private(set) var routeGeneration = 0

  /// Latest wake level reported to the phone, and the heartbeat that keeps re-asserting it.
  private var wakeLevel: WatchMirrorWakeLevel = .asleep
  private var wakeHeartbeat: Timer?

  /// Arrival timestamps inside the rolling window. `applied` diverges from `received` only once
  /// something coalesces frames; today every decoded frame is published, so equal rates are the
  /// expected reading and a gap between them is a finding.
  private var received: [Date] = []
  private var applied: [Date] = []

  private var latestFrame: WatchFrame?
  private var lastFrameAtMs: Int64?
  /// Gap between the two most recent frames: the phone's push cadence, as actually observed. The
  /// disconnect window is measured off it rather than assumed, so a rider-chosen slower cadence
  /// does not pin the mirror offline.
  private var frameGapMs: Int64?

  var receivedHz: Double { rate(received) }
  var appliedHz: Double { rate(applied) }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  /// Tell the phone how awake the Mirror is. The phone picks its push cadence from this, so it is
  /// re-asserted on a heartbeat: an absent level is what lets the phone notice a wrist that stopped
  /// running without ever getting a chance to say so.
  ///
  /// The message is fire-and-forget on the same transport the frames use. A dropped tick costs
  /// nothing — the next one is 15 s away, and until then the phone keeps the cadence it had.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `wakeHeartbeat`
  func reportWakeLevel(_ level: WatchMirrorWakeLevel) {
    wakeLevel = level
    sendWakeLevel()
    wakeHeartbeat?.invalidate()
    guard level != .asleep else { return }
    wakeHeartbeat = Timer.scheduledTimer(
      withTimeInterval: Double(watchMirrorAwakeHeartbeatMs) / 1000,
      repeats: true
    ) { [weak self] _ in self?.sendWakeLevel() }
  }

  /// Flip one of the board's light switches. The wrist sends the *edit* and never both switches:
  /// the phone composes the pair it writes from its own board truth, so a wrist holding a slightly
  /// stale board push cannot revert the switch the rider did not touch.
  ///
  /// Fire-and-forget, like every other wrist command. `sendMessageData` has no delivery guarantee,
  /// which is exactly why the optimistic value the caller holds has to time out rather than wait —
  /// see ``LightsScreen``.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `sendLights`
  func sendLights(_ `switch`: WatchLightsSwitch, on: Bool) {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return }
    session.sendMessageData(
      WatchCommandCodec.encode(.lights(`switch`, on)),
      replyHandler: nil,
      errorHandler: nil
    )
  }

  /// Re-state the direction the rider is holding, or `0` for the release. Direction only: the
  /// phone scales it by the rider's strength setting and owns every gate around it.
  ///
  /// Fire-and-forget on `sendMessageData`, and that is load-bearing rather than a limitation.
  /// `sendMessageData` drops when the phone is unreachable; it never queues. The deferred paths —
  /// `transferUserInfo`, the Application Context — must never be used here, because a FIFO queue
  /// would deliver a backlog of stale holds after a reconnect, i.e. a board that starts rolling by
  /// itself minutes after the rider let go. A dropped tick is covered by the next one, and the tick
  /// that never comes is covered by the phone's dead-man.
  ///
  /// So a stop cannot get stuck behind the holds that preceded it: there is nothing for it to be
  /// behind. Android has to build a latest-wins slot in front of its blocking Data Layer send to
  /// get the same property.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `sendMove`
  /// @platform-diff `WCSession.sendMessageData` is already latest-wins and non-blocking, so the
  ///   wrist needs no coalescing queue of its own.
  func sendMove(_ direction: Int) {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return }
    session.sendMessageData(
      WatchCommandCodec.encode(.move(direction)),
      replyHandler: nil,
      errorHandler: nil
    )
  }

  private func sendWakeLevel() {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return }
    session.sendMessageData(
      WatchCommandCodec.encode(.mirrorAwake(wakeLevel)),
      replyHandler: nil,
      errorHandler: nil
    )
  }

  /// Ages a stopped stream into `disconnected` without an explicit phone message. The UI drives
  /// this off its own timeline, so the tick slows down in the Always On state with everything else.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/TelemetryState.kt `refresh`
  func refresh() {
    mirror = MirrorStateReducer.reduce(
      frame: latestFrame,
      lastFrameAtMs: lastFrameAtMs,
      nowMs: Self.nowMs(),
      timeoutMs: MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: frameGapMs)
    )
  }

  /// The watch's own monotonic clock. A wall clock would let a phone time-sync jump the mirror
  /// straight to `disconnected`, or worse, hold a dead stream open.
  private static func nowMs() -> Int64 { Int64(ProcessInfo.processInfo.systemUptime * 1000) }

  private func rate(_ stamps: [Date]) -> Double {
    guard stamps.count > 1, let first = stamps.first, let last = stamps.last else { return 0 }
    let span = last.timeIntervalSince(first)
    guard span > 0 else { return 0 }
    return Double(stamps.count - 1) / span
  }

  private func mark(_ stamps: inout [Date], _ now: Date) {
    stamps.append(now)
    let cutoff = now.addingTimeInterval(-Self.rateWindow)
    stamps.removeAll { $0 < cutoff }
  }

  /// The facts `WCSession` publishes on the wrist, read in the order their failures nest: a session
  /// that has not activated says nothing about the companion, and a missing companion says nothing
  /// about the radio link.
  ///
  /// Android distinguishes "no connected node" from "node present, capability absent" with two
  /// separate queries. watchOS has no pairing query on this side — `isPaired` is the phone's — so
  /// the absent companion and the dead link are read off the two flags it does publish. A watch app
  /// only runs on a paired watch anyway, which is why the unpaired case does not need a third.
  ///
  /// @platform-diff `WCSession.isPaired` is iOS-only; the wrist infers the same three reasons from
  ///   activation, companion-installed and reachability.
  private func syncCounterpart(_ session: WCSession) {
    activation = session.activationState
    reachable = session.isReachable
    companionInstalled = session.isCompanionAppInstalled
    // Cold state the system already holds for this app, including from before this launch. Read on
    // every counterpart change, not only at activation: `receivedApplicationContext` is the latest
    // value either way, so re-reading it is free and covers a context that landed while the app
    // was not running.
    acceptColdState(session.receivedApplicationContext)
    link = {
      guard session.activationState == .activated else { return .unknown }
      if !session.isCompanionAppInstalled { return .phoneOnly }
      // Installed but out of touch: the radio link to the phone is what is missing, which is the
      // same thing a rider fixes as Android's "no connected node".
      return session.isReachable ? .appReachable : .noPhone
    }()
  }

  /// Replay's way in, taking exactly the path a decoded phone frame takes. Anything narrower would
  /// be replaying against a different code path than the one that ships, which is the one bug a
  /// visual harness must not have.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `FrameReplayer`
  @MainActor
  func acceptReplayFrame(_ frame: WatchFrame) {
    let now = Date()
    mark(&received, now)
    mark(&applied, now)
    let nowMs = Self.nowMs()
    if let previous = lastFrameAtMs { frameGapMs = max(nowMs - previous, 0) }
    latestFrame = frame
    lastFrameAtMs = nowMs
    lastFrameAt = now
    refresh()
  }

  /// One context, several channels. Only the channels this build knows are read; the rest are the
  /// phone's business, and a channel this build has never heard of must not look like a change.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `dataListener`
  private func acceptColdState(_ context: [String: Any]) {
    let next = WatchSettings.decode(context: context)
    if next != settings { settings = next }
    let forecast = WatchWeather.decode(context: context)
    // Equality ignores `fetchedAtMs`, so a re-push of the same numbers must still land: the wrist
    // ages a forecast off that stamp, and keeping the old one would retire weather the phone is
    // still refreshing. Only an absent channel leaves the wrist with nothing.
    if forecast != weather || forecast?.fetchedAtMs != weather?.fetchedAtMs { weather = forecast }
    let lights = WatchBoardLights.decode(context: context)
    if lights != board { board = lights }
    let path = WatchRoute.decode(context: context)
    if path != route {
      route = path
      routeGeneration += 1
    }
  }

  /// The pushed forecast while it is still worth believing, else nil.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `freshWeather`
  func freshWeather(nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> WatchWeather? {
    guard let weather, weather.isFresh(nowMs: nowMs) else { return nil }
    return weather
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    DispatchQueue.main.async { self.syncCounterpart(session) }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async {
      self.syncCounterpart(session)
      // A phone that just became reachable has not heard this wrist's wake level since it went
      // away, and the heartbeat is up to 15 s out. Re-assert immediately so the cadence is right
      // for the frames that start flowing now, not for the ones after the next tick.
      if session.isReachable, self.wakeLevel != .asleep { self.sendWakeLevel() }
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    DispatchQueue.main.async { self.acceptColdState(applicationContext) }
  }

  func sessionCompanionAppInstalledDidChange(_ session: WCSession) {
    DispatchQueue.main.async { self.syncCounterpart(session) }
  }

  func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
    let now = Date()
    let nowMs = Self.nowMs()
    // Timestamped on arrival, off the main queue, so a busy or throttled UI cannot make the received
    // rate look slower than it was. That distinction is the whole point of measuring both.
    guard let decoded = WatchFrameBuilder.decode(messageData) else {
      DispatchQueue.main.async { self.rejected += 1 }
      return
    }
    DispatchQueue.main.async {
      self.mark(&self.received, now)
      self.mark(&self.applied, Date())
      if let previous = self.lastFrameAtMs { self.frameGapMs = max(nowMs - previous, 0) }
      self.latestFrame = decoded
      self.lastFrameAtMs = nowMs
      self.lastFrameAt = now
      self.refresh()
    }
  }
}
