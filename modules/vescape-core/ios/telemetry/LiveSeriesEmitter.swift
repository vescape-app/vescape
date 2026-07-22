import Foundation

/// Keeps a rolling in-memory window of recent telemetry ticks and, ~1 Hz, emits a per-metric
/// decimated `onLiveSeries` event (flat `[ts, value, ...]` arrays over `LIVE_SERIES_BUCKETS`
/// buckets across the live-history window). This is what the center-screen sparklines and the
/// battery gauge read — `onLiveTick` only carries the instant scalar for the numeric gauges.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/LiveSeriesEmitter.kt
/// @platform-diff iOS decimates a plain in-memory tick buffer instead of Android's `TelemetryPipeline`,
/// and has no metric-sanitizer exclusions yet (speed/duty are emitted unconditionally). The event
/// shape, cadence, bucket count, and window semantics match.
internal final class LiveSeriesEmitter {
  private static let intervalMs = 1_000
  private static let buckets = 64
  /// One display frame — the fastest an emit can usefully arrive. See `scaledIntervalMs`.
  private static let minIntervalMs = 16
  /// Focused detail-chart resolution: fixed-width time buckets (constant scrub resolution
  /// regardless of window length), capped so a long window can't blow up the payload.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `FOCUSED_SERIES_BUCKET_WIDTH_MS`
  private static let focusedBucketWidthMs: Int64 = 250
  private static let focusedMaxBuckets = 1_500

  /// Send a native event to JS. Wired by the coordinator.
  var emit: ((String, [String: Any?]) -> Void)?
  /// Current connection generation, stamped onto each emit so JS can drop stale series.
  var generation: () -> Int64 = { 0 }
  /// How fast session time is running; see `scaledIntervalMs`. Wired by the coordinator.
  var speed: () -> Double = { 1.0 }

  private var windowMs: Int64 = 5 * 60_000
  /// Guards `samples`: appended/pruned on the main (BLE callback) queue, but read via
  /// `recentSnapshot()` from the JS thread on `getLiveState`. All access holds `samplesLock`.
  private let samplesLock = NSLock()
  private var samples: [[String: Any?]] = []
  private var active = false
  private var primed = false
  private var tickSeq = 0
  /// Metric keys the mounted `/control` detail charts are focused on (JS intent); empty = none.
  /// Mutated and read on the main queue alongside the tick.
  private var focusedMetrics: Set<String> = []

  /// Set the live-history window (minutes) from the `liveHistoryLimit` setting.
  func setWindowMinutes(_ minutes: Int) {
    windowMs = Int64(max(1, minutes)) * 60_000
    samplesLock.lock()
    prune()
    samplesLock.unlock()
  }

  /// Thread-safe copy of the recent raw-tick window backing `board.recentTelemetry`. Same buffer,
  /// window, and ordering as the decimated `onLiveSeries` emit — no second buffer. Mirrors Android
  /// `TelemetryPipeline.recentSnapshot`.
  func recentSnapshot() -> [[String: Any?]] {
    samplesLock.lock()
    defer { samplesLock.unlock() }
    return samples
  }

  func start() {
    guard !active else { return }
    active = true
    primed = false
    scheduleTick()
  }

  func stop() {
    active = false
    primed = false
    tickSeq &+= 1
    samplesLock.lock()
    samples.removeAll(keepingCapacity: true)
    samplesLock.unlock()
  }

  /// Append a decoded tick (the same map emitted on `onLiveTick`, carrying `lastPacketAt` plus the
  /// metric fields). Emits immediately on the first sample of a session so gauges light up without
  /// waiting a full tick interval.
  func add(_ sample: [String: Any?]) {
    samplesLock.lock()
    samples.append(sample)
    prune()
    samplesLock.unlock()
    if active && !primed {
      primed = true
      emitSeries()
    }
  }

  /// Caller must hold `samplesLock`.
  private func prune() {
    guard let newest = timestamp(samples.last) else { return }
    let oldest = newest - windowMs
    if let firstKeep = samples.firstIndex(where: { (timestamp($0) ?? 0) >= oldest }), firstKeep > 0 {
      samples.removeFirst(firstKeep)
    }
  }

  /// The interval is a wall-clock throttle on bridge traffic, not a description of the ride, so it
  /// stays on wall time. What it does have to track is the *rate* of the data feeding it: a replay
  /// warming up delivers a minute of ride every couple of seconds, and a fixed 1s timer would hand
  /// JS that minute in a couple of frames — the sparklines jump rather than fast-forward. Dividing
  /// by the session speed keeps each emit as current as it would be live.
  ///
  /// Floored at one display frame: emitting faster than the screen refreshes is pure waste, and it
  /// bounds the cost of an extreme speed.
  private func scaledIntervalMs() -> Int {
    let currentSpeed = speed()
    guard currentSpeed > 1.0 else { return Self.intervalMs }
    return max(Self.minIntervalMs, Int(Double(Self.intervalMs) / currentSpeed))
  }

  private func scheduleTick() {
    guard active else { return }
    tickSeq &+= 1
    let expected = tickSeq
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.active, self.tickSeq == expected else { return }
      self.emitSeries()
      self.emitFocusedSeries()
      self.scheduleTick()
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(scaledIntervalMs()) / 1000.0, execute: work)
  }

  private func emitSeries() {
    let samples = recentSnapshot()
    guard !samples.isEmpty else { return }
    var metrics: [String: Any?] = [:]
    for metric in Self.centerMetrics {
      let series = LiveSeriesDownsampler.downsampleMinMax(
        samples,
        bucketCount: Self.buckets,
        windowMs: windowMs,
        timestamp: { self.timestamp($0) ?? 0 },
        value: metric.select
      )
      if !series.isEmpty { metrics[metric.key] = series }
    }
    guard !metrics.isEmpty else { return }
    emit?("onLiveSeries", ["metrics": metrics, "generation": generation()])
  }

  /// Set which metrics the high-res focused stream covers (empty to stop it); emits immediately.
  func setFocusedMetrics(_ metrics: [String]) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.focusedMetrics = Set(metrics)
      if !metrics.isEmpty { self.emitFocusedSeries() }
    }
  }

  private func emitFocusedSeries() {
    guard !focusedMetrics.isEmpty else { return }
    let samples = recentSnapshot()
    let bucketCount = max(1, min(Self.focusedMaxBuckets, Int(windowMs / Self.focusedBucketWidthMs)))
    for metric in focusedMetrics {
      guard let m = Self.allMetrics.first(where: { $0.key == metric }) else { continue }
      let series = LiveSeriesDownsampler.downsampleMinMax(
        samples,
        bucketCount: bucketCount,
        windowMs: windowMs,
        timestamp: { self.timestamp($0) ?? 0 },
        value: m.select
      )
      // iOS has no metric sanitizer yet, so no exclusion spans ride along — see the class @platform-diff.
      emit?("onFocusedSeries", [
        "metric": metric,
        "series": series,
        "exclusions": [String: [Double]](),
        "windowMs": windowMs,
        "generation": generation(),
      ])
    }
  }

  private func timestamp(_ sample: [String: Any?]?) -> Int64? {
    guard let sample else { return nil }
    return Self.num(sample, "lastPacketAt").map { Int64($0) }
  }

  // MARK: - Metric selectors (mirrors Android `LIVE_SERIES_METRICS`)

  private struct Metric {
    let key: String
    let select: ([String: Any?]) -> Double?
  }

  /// Center-screen metrics streamed continuously on `onLiveSeries` (strip + gauge + battery).
  private static let centerMetrics: [Metric] = [
    Metric(key: "motorTemp") { num($0, "tempMotor").flatMap { $0 > 0 ? $0 : nil } },
    Metric(key: "controllerTemp") { num($0, "tempMosfet") },
    Metric(key: "motorCurrent") { num($0, "motorCurrent") },
    Metric(key: "batteryCurrent") { num($0, "batteryCurrent") },
    Metric(key: "batteryVoltage") { num($0, "batteryVoltage") },
    Metric(key: "batteryPercent") { num($0, "batteryPercent") },
    Metric(key: "speed") { num($0, "speed").map { abs($0) } },
    Metric(key: "duty") { num($0, "dutyCycle").map { abs($0) * 100 } },
  ]

  /// Detail-chart-only metrics (no center sparkline); served only via `onFocusedSeries` on focus.
  private static let focusedOnlyMetrics: [Metric] = [
    Metric(key: "pitch") { num($0, "pitch") },
    Metric(key: "roll") { num($0, "roll") },
    Metric(key: "balancePitch") { num($0, "balancePitch") },
    Metric(key: "footpadAdc1") { num($0, "adc1") },
    Metric(key: "footpadAdc2") { num($0, "adc2") },
  ]

  /// Every metric a `/control` detail chart can focus (center + detail-only).
  private static let allMetrics: [Metric] = centerMetrics + focusedOnlyMetrics

  private static func num(_ map: [String: Any?], _ key: String) -> Double? {
    guard let raw = map[key] ?? nil else { return nil }
    if let d = raw as? Double { return d }
    if let i = raw as? Int { return Double(i) }
    if let i = raw as? Int64 { return Double(i) }
    if let n = raw as? NSNumber { return n.doubleValue }
    return nil
  }
}
