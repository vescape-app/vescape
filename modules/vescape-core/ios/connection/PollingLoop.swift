import Foundation

/// Response-paced telemetry polling with a dropped-response safety retry.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/PollingLoop.kt
internal final class PollingLoop {
  private let scheduler: Scheduler
  private let isCurrentSession: (BoardSession) -> Bool
  private let sendPayload: ([UInt8], BoardSession) -> Bool
  private let nowMs: () -> Int64

  private var pollWork: Cancellable?
  private var safetyWork: Cancellable?
  private var session: BoardSession?
  private var pollPayload: [UInt8] = []
  private var bmsPayload: [UInt8]?
  private var lastPollAt: Int64 = 0
  private var tick: Int64 = 0
  private var smoothedPeriodMs = 0.0
  private var floorMs: Int64 = 0

  private(set) var isActive = false

  init(
    scheduler: Scheduler,
    isCurrentSession: @escaping (BoardSession) -> Bool,
    sendPayload: @escaping ([UInt8], BoardSession) -> Bool,
    nowMs: @escaping () -> Int64
  ) {
    self.scheduler = scheduler
    self.isCurrentSession = isCurrentSession
    self.sendPayload = sendPayload
    self.nowMs = nowMs
  }

  func start(
    session: BoardSession,
    pollPayload: [UInt8],
    bmsPayload: [UInt8]?,
    pollIntervalMs: Int
  ) {
    stop()
    self.session = session
    self.pollPayload = pollPayload
    self.bmsPayload = bmsPayload
    floorMs = Int64(max(0, pollIntervalMs))
    lastPollAt = 0
    tick = 0
    smoothedPeriodMs = 0
    isActive = true
    sendNow()
  }

  func setPollIntervalMs(_ intervalMs: Int) {
    floorMs = Int64(max(0, intervalMs))
  }

  func stop() {
    isActive = false
    pollWork?.cancel()
    pollWork = nil
    cancelSafety()
    session = nil
  }

  func onResponse() {
    guard let session, isActive else { return }
    cancelSafety()
    let elapsed = nowMs() - lastPollAt
    let delayMs = max(0, floorMs - elapsed)
    pollWork?.cancel()
    pollWork = scheduler.postDelayedForSession(session, delayMs: delayMs, isCurrent: isCurrentSession) { [weak self] _ in
      self?.pollWork = nil
      self?.sendNow()
    }
  }

  func measuredRateHz() -> Double? {
    smoothedPeriodMs > 0 ? 1000.0 / smoothedPeriodMs : nil
  }

  func latency(at now: Int64) -> Int? {
    lastPollAt > 0 ? Int(max(0, now - lastPollAt)) : nil
  }

  private func sendNow() {
    guard let session, isActive, session.isActive, isCurrentSession(session) else { return }
    pollWork = nil
    let now = nowMs()
    if lastPollAt > 0 {
      let delta = Double(now - lastPollAt)
      smoothedPeriodMs = smoothedPeriodMs <= 0 ? delta : smoothedPeriodMs + 0.2 * (delta - smoothedPeriodMs)
    }
    lastPollAt = now
    _ = sendPayload(pollPayload, session)
    if let bmsPayload, tick % 8 == 0 {
      _ = sendPayload(bmsPayload, session)
    }
    tick += 1
    armSafety(session: session, tick: tick)
  }

  private func armSafety(session: BoardSession, tick: Int64) {
    cancelSafety()
    safetyWork = scheduler.postDelayedForSession(
      session,
      delayMs: max(floorMs * 4, 1000),
      isCurrent: isCurrentSession
    ) { [weak self] _ in
      guard let self, self.isActive, self.tick == tick else { return }
      self.safetyWork = nil
      self.sendNow()
    }
  }

  private func cancelSafety() {
    safetyWork?.cancel()
    safetyWork = nil
  }
}
