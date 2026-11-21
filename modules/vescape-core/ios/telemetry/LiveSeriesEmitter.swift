import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/LiveSeriesEmitter.kt
/// @platform-diff iOS decimates a plain in-memory tick buffer instead of Android's `TelemetryPipeline`,
/// and has no metric-sanitizer exclusions yet (speed/duty are emitted unconditionally). The event
/// shape, cadence, bucket count, and window semantics match.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `ProcessedTelemetry`
internal struct LivePeaks {
  let speed: Double?
  let duty: Double?
}

internal final class LiveSeriesEmitter {
  private static let intervalMs = 1_000
  private static let buckets = 64
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `FOCUSED_SERIES_BUCKET_WIDTH_MS`
  private static let focusedBucketWidthMs: Int64 = 20

  var emit: ((String, [String: Any?]) -> Void)?
  var generation: () -> Int64 = { 0 }

  private var windowMs: Int64 = 5 * 60_000
  private let samplesLock = NSLock()
  private var samples: [[String: Any?]] = []
  private let speedPeak = LiveWindowPeak(select: LiveSeriesEmitter.metric("speed").select)
  private let dutyPeak = LiveWindowPeak(select: LiveSeriesEmitter.metric("duty").select)
  private var active = false
  private var primed = false
  private var tickSeq = 0
  private var focusedMetrics: Set<String> = []
  private var extraLiveMetrics: [Metric] = []
  private let scheduler: Scheduler

  init(scheduler: Scheduler = MainQueueScheduler()) {
    self.scheduler = scheduler
  }

  func setWindowMinutes(_ minutes: Int) {
    windowMs = Int64(max(1, minutes)) * 60_000
    samplesLock.lock()
    prune()
    samplesLock.unlock()
  }

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
    speedPeak.reset()
    dutyPeak.reset()
    samplesLock.unlock()
  }

  @discardableResult
  func add(_ sample: [String: Any?]) -> LivePeaks {
    samplesLock.lock()
    append(sample)
    let peaks = LivePeaks(speed: speedPeak.value(samples), duty: dutyPeak.value(samples))
    samplesLock.unlock()
    if active && !primed {
      primed = true
      emitSeries()
    }
    return peaks
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `prefill`
  func prefill(_ sample: [String: Any?]) {
    samplesLock.lock()
    append(sample)
    samplesLock.unlock()
  }

  private func append(_ sample: [String: Any?]) {
    samples.append(sample)
    speedPeak.add(sample)
    dutyPeak.add(sample)
    prune()
  }

  private func prune() {
    guard let newest = timestamp(samples.last) else { return }
    let oldest = newest - windowMs
    if let firstKeep = samples.firstIndex(where: { (timestamp($0) ?? 0) >= oldest }), firstKeep > 0 {
      for dropped in samples[..<firstKeep] {
        speedPeak.evict(dropped)
        dutyPeak.evict(dropped)
      }
      samples.removeFirst(firstKeep)
    }
  }

  private func scheduleTick() {
    guard active else { return }
    tickSeq &+= 1
    let expected = tickSeq
    scheduler.postDelayed(Int64(Self.intervalMs)) { [weak self] in
      guard let self, self.active, self.tickSeq == expected else { return }
      self.emitSeries()
      self.emitFocusedSeries()
      self.scheduleTick()
    }
  }

  private func emitSeries() {
    let samples = recentSnapshot()
    guard !samples.isEmpty else { return }
    var metrics: [String: Any?] = [:]
    for metric in Self.centerMetrics + extraLiveMetrics {
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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/LiveSeriesEmitter.kt `setLiveMetrics`
  func setLiveMetrics(_ metrics: [String]) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let keys = Set(metrics)
      self.extraLiveMetrics = Self.allMetrics.filter { metric in
        keys.contains(metric.key) && !Self.centerMetrics.contains { $0.key == metric.key }
      }
      if self.active { self.emitSeries() }
    }
  }

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
    guard !samples.isEmpty else { return }
    let bucketCount = max(1, Int(windowMs / Self.focusedBucketWidthMs))
    let firstTs = timestamp(samples.first) ?? 0
    let lastTs = timestamp(samples.last) ?? 0
    let spanMs = max(0, lastTs - firstTs)
    let sampleRateHz = spanMs > 0 ? Double(samples.count - 1) * 1000.0 / Double(spanMs) : 0
    for metric in focusedMetrics {
      guard let m = Self.allMetrics.first(where: { $0.key == metric }) else { continue }
      let series = LiveSeriesDownsampler.downsampleMinMax(
        samples,
        bucketCount: bucketCount,
        windowMs: windowMs,
        timestamp: { self.timestamp($0) ?? 0 },
        value: m.select
      )
      emit?("onFocusedSeries", [
        "metric": metric,
        "series": series,
        "exclusions": [String: [Double]](),
        "windowMs": windowMs,
        "spanMs": spanMs,
        "sampleRateHz": sampleRateHz,
        "generation": generation(),
      ])
    }
  }

  private func timestamp(_ sample: [String: Any?]?) -> Int64? {
    guard let sample else { return nil }
    return Self.num(sample, "lastPacketAt").map { Int64($0) }
  }

  private struct Metric {
    let key: String
    let select: ([String: Any?]) -> Double?
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `LIVE_SERIES_METRICS`
  /// @parity /src/modules/board/hooks/useLiveMetric.ts `liveSelectors`
  private static let centerMetrics: [Metric] = [
    Metric(key: "batteryVoltage") { num($0, "batteryVoltage") },
    Metric(key: "batteryPercent") { num($0, "batteryPercent") },
  ]

  private static let focusedOnlyMetrics: [Metric] = [
    Metric(key: "motorTemp") { num($0, "tempMotor").flatMap { $0 > 0 ? $0 : nil } },
    Metric(key: "controllerTemp") { num($0, "tempMosfet") },
    Metric(key: "motorCurrent") { num($0, "motorCurrent") },
    Metric(key: "batteryCurrent") { num($0, "batteryCurrent") },
    Metric(key: "speed") { num($0, "speed").map { abs($0) } },
    Metric(key: "duty") { num($0, "dutyCycle").map { abs($0) * 100 } },
    Metric(key: "pitch") { num($0, "pitch") },
    Metric(key: "roll") { num($0, "roll") },
    Metric(key: "balancePitch") { num($0, "balancePitch") },
    Metric(key: "footpadAdc1") { num($0, "adc1") },
    Metric(key: "footpadAdc2") { num($0, "adc2") },
  ]

  private static let allMetrics: [Metric] = centerMetrics + focusedOnlyMetrics

  private static func metric(_ key: String) -> Metric {
    allMetrics.first { $0.key == key }!
  }

  private static func num(_ map: [String: Any?], _ key: String) -> Double? {
    guard let raw = map[key] ?? nil else { return nil }
    if let d = raw as? Double { return d }
    if let i = raw as? Int { return Double(i) }
    if let i = raw as? Int64 { return Double(i) }
    if let n = raw as? NSNumber { return n.doubleValue }
    return nil
  }
}
