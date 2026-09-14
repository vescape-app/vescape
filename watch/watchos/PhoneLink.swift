import Foundation
import WatchConnectivity

/// Wrist-side end of the Watch Frame path (ADR-0019). Receives the frames `WatchTelemetryPusher`
/// sends from `vescape-core` and publishes the decoded lanes plus the lifecycle evidence the port
/// is blocked on: what the session thinks its state is, when the last frame actually landed, and at
/// what rate they are arriving versus being shown.
///
/// Nothing here interprets the ride. Decoding is `WatchFrame.swift`, which is the phone's own file
/// symlinked in, so the wrist cannot drift from the encoder.
///
/// @parity /modules/vescape-core/ios/watch/WatchTelemetryPusher.swift
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorState.kt
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
  /// Rolling window the received/applied rates are measured over. Long enough to survive one missed
  /// push at the slowest cadence worth reporting, short enough to show a stall while it is happening.
  private static let rateWindow: TimeInterval = 5

  @Published private(set) var frame: WatchFrame?
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

  var receivedHz: Double { rate(received) }
  var appliedHz: Double { rate(applied) }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

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

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    DispatchQueue.main.async {
      self.activation = activationState
      self.reachable = session.isReachable
      self.companionInstalled = session.isCompanionAppInstalled
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async {
      self.reachable = session.isReachable
      self.companionInstalled = session.isCompanionAppInstalled
    }
  }

  func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
    let now = Date()
    // Timestamped on arrival, off the main queue, so a busy or throttled UI cannot make the received
    // rate look slower than it was. That distinction is the whole point of measuring both.
    guard let decoded = WatchFrameBuilder.decode(messageData) else {
      DispatchQueue.main.async { self.rejected += 1 }
      return
    }
    DispatchQueue.main.async {
      self.mark(&self.received, now)
      self.mark(&self.applied, Date())
      self.frame = decoded
      self.lastFrameAt = now
    }
  }
}
