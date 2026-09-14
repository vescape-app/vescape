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

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    DispatchQueue.main.async { self.syncCounterpart(session) }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async { self.syncCounterpart(session) }
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
