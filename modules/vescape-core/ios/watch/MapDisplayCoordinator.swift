import Foundation

/// Native input ownership. All calls run on the owning serial queue; clocks/scheduling injected.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/display/MapDisplayCoordinator.kt
/// @parity /modules/vescape-core/src/mapDisplay.ts
final class MapDisplayCoordinator {
  let model = LiveGpsMotion()
  private let clock: () -> Double
  private let schedule: (Double, @escaping () -> Void) -> (() -> Void)
  private let emit: ([String: Any]) -> Void
  private var active = false
  private var diagnostics = false
  private var trailEnabled = false
  private var rawEnabled = false
  private var source = -1.0
  private var benchSource = 0.0
  private var generation = -1.0
  private var connected = false
  private var rate = 1.0
  private var localAnchor = 0.0
  private var displayAnchor = 0.0
  private var sourceAnchor = 0.0
  private var sourceDisplayAnchor = 0.0
  private var latestClock = -Double.infinity
  private var latestRawTimestamp = -Double.infinity
  private var lastTrailSampleLocal = -Double.infinity
  private var lastSpeedAt = -Double.infinity
  private var lastDiagnosticsAt = -Double.infinity
  private var diagnosticSnapshot: [String: Any]?
  private var revision = 0
  private var raw: [String: Any]?
  private var trail: [(at: Double, coordinate: [Double])] = []
  private var cancelDebug: (() -> Void)?
  private var cancelBoundary: (() -> Void)?

  init(clock: @escaping () -> Double,
       schedule: @escaping (Double, @escaping () -> Void) -> (() -> Void),
       emit: @escaping ([String: Any]) -> Void) {
    self.clock = clock
    self.schedule = schedule
    self.emit = emit
  }
  private func now() -> Double { displayAnchor + (clock() - localAnchor) * rate }
  private func age(_ timestamp: Double) -> Double { max(0, sourceAnchor + now() - sourceDisplayAnchor - timestamp) }
  private func number(_ body: [String: Any], _ key: String) -> Double? { (body[key] as? NSNumber)?.doubleValue }

  func stop() {
    active = false
    cancelDebug?()
    cancelBoundary?()
    cancelDebug = nil
    cancelBoundary = nil
    trail = []
    raw = nil
  }
  func options(_ body: [String: Any]) {
    let wasActive = active
    active = body["active"] as? Bool ?? active
    let nextDiagnostics = body["diagnostics"] as? Bool ?? diagnostics
    if nextDiagnostics != diagnostics { lastDiagnosticsAt = -.infinity }
    diagnostics = nextDiagnostics
    trailEnabled = body["trail"] as? Bool ?? trailEnabled
    rawEnabled = body["raw"] as? Bool ?? rawEnabled
    if !trailEnabled { trail = [] }
    if !rawEnabled && !diagnostics {
      raw = nil
      latestRawTimestamp = -.infinity
    }
    guard active else {
      stop()
      return
    }
    if !wasActive {
      source = -1
      latestClock = -.infinity
    }
    publish()
  }
  private func adopt(_ body: [String: Any]) -> Bool {
    guard let id = number(body, "displaySourceId"), let sourceClock = number(body, "displayClockMs"),
      id.isFinite, sourceClock.isFinite, id >= source else { return false }
    let reset = id > source
    if !reset && (sourceClock < latestClock || (sourceClock == latestClock && number(body, "displayClockRate") != rate)) { return false }
    if reset {
      source = id
      model.reset(source: source, now: now())
      raw = nil
      lastDiagnosticsAt = -.infinity
      trail = []
      latestRawTimestamp = -.infinity
      lastSpeedAt = -.infinity
    }
    displayAnchor = now()
    localAnchor = clock()
    let nextRate = number(body, "displayClockRate") ?? 1
    rate = nextRate.isFinite ? min(100, max(0.1, nextRate)) : 1
    sourceAnchor = sourceClock
    sourceDisplayAnchor = now()
    latestClock = sourceClock
    return true
  }
  func input(_ name: String, _ body: [String: Any]) {
    guard active else { return }
    switch name {
    case "onLiveState":
      guard let board = body["board"] as? [String: Any], let seq = number(board, "connectionSeq"), seq >= generation,
        let gps = body["gps"] as? [String: Any], adopt(gps) else { return }
      generation = seq
      connected = board["phase"] as? String == "connected"
      let candidates = ["latestFix", "latestApproximateFix", "latestPreciseFix"]
        .compactMap { gps[$0] as? [String: Any] }
        .filter { number($0, "timestamp")?.isFinite == true }
      if let latest = candidates.max(by: { number($0, "timestamp")! < number($1, "timestamp")! }) { fix(latest) }
      if !connected { model.updateSpeed(nil, revision: sourceAnchor + now() - sourceDisplayAnchor, receivedAt: now(), source: source) }
      else if let latest = (board["recentTelemetry"] as? [[String: Any]])?.last { _ = tick(latest) }
    case "onLocation":
      guard adopt(body) else { return }
      fix(body)
    case "onLiveTick":
      let oldSource = source
      let oldRate = rate
      guard connected, number(body, "generation") == generation, adopt(body) else { return }
      if !tick(body) && source == oldSource && rate == oldRate { return }
    default: return
    }
    publish()
  }
  private func fix(_ body: [String: Any], ageOverride: Double? = nil) {
    guard let timestamp = number(body, "timestamp") else { return }
    let longitude = number(body, "longitude") ?? .nan
    let latitude = number(body, "latitude") ?? .nan
    let accuracy = number(body, "accuracyM")
    let at = now()
    let inputAge = ageOverride ?? age(timestamp)
    sample(at, boundary: true)
    let accepted = model.accept(MotionFix(longitude: longitude, latitude: latitude, timestamp: timestamp, accuracyM: accuracy),
      receivedAt: at, ageMs: inputAge, source: source)
    if (rawEnabled || diagnostics) && timestamp.isFinite && timestamp > latestRawTimestamp {
      latestRawTimestamp = timestamp
      if longitude.isFinite && latitude.isFinite && abs(longitude) <= 180 && abs(latitude) <= 90 {
        raw = ["coordinate": [longitude, latitude], "timestamp": timestamp, "atMs": at - inputAge,
           "accepted": accepted || model.isAcceptedFix(timestamp), "accuracyM": accuracy.flatMap { $0.isFinite ? $0 : nil } as Any? ?? NSNull()]
      }
    }
  }
  private func tick(_ body: [String: Any]) -> Bool {
    guard number(body, "generation") == generation, let timestamp = number(body, "lastPacketAt") else { return false }
    let speed = number(body, "speed")
    let at = now()
    if speed != 0 && clock() - lastSpeedAt < 100 { return false }
    sample(at)
    let previous = model.predictionChangeKey(at)
    let changed = model.updateSpeed(speed.map { $0 / 3.6 }, revision: timestamp, receivedAt: at, source: source, ageMs: age(timestamp))
    if changed { lastSpeedAt = clock() }
    return changed && previous != model.predictionChangeKey(at)
  }
  func configure(_ config: MotionConfig) {
    sample(now(), boundary: true)
    model.configure(config, now: now())
    if active { publish() }
  }
  /// Synthetic measurements stay outside live providers, Watch Frames and storage.
  func bench(_ body: [String: Any]) {
    guard active else { return }
    let at = now()
    switch body["op"] as? String {
    case "reset":
      benchSource += 1
      source = benchSource
      model.reset(source: source, now: at)
      trail = []
      raw = nil
      latestRawTimestamp = -.infinity
      lastDiagnosticsAt = -.infinity
    case "fix": fix(body, ageOverride: 0)
    case "speed":
      sample(at)
      model.updateSpeed(number(body, "mps"), revision: at, receivedAt: at, source: source)
    default: break
    }
    publish()
  }
  private func sample(_ at: Double, boundary: Bool = false) {
    if !boundary && clock() - lastTrailSampleLocal < 200 { return }
    guard trailEnabled, let position = model.position(at) else { return }
    let coordinate = [position.longitude, position.latitude]
    if trail.last?.coordinate != coordinate {
      trail.append((at, coordinate))
      lastTrailSampleLocal = clock()
    }
    trail.removeAll { at - $0.at > 60_000 }
    trail = Array(trail.suffix(300))
  }
  func snapshot() -> [String: Any] {
    let at = now()
    var result = model.snapshot(at)
    result["source"] = source
    result["revision"] = revision
    result["clockMs"] = at
    result["localClockMs"] = clock()
    result["clockRate"] = rate
    var rawSnapshot = raw
    if let rawAt = raw?["atMs"] as? Double { rawSnapshot?["stale"] = at - rawAt >= model.config.gpsFreshnessS * 1000 }
    result["raw"] = rawEnabled || diagnostics ? rawSnapshot as Any? ?? NSNull() : NSNull()
    if active && diagnostics && clock() - lastDiagnosticsAt >= 1000 {
      diagnosticSnapshot = model.diagnostics(at)
      diagnosticSnapshot?["raw"] = rawSnapshot as Any? ?? NSNull()
      lastDiagnosticsAt = clock()
    }
    result["trail"] = trailEnabled ? trail.map { $0.coordinate } : []
    result["diagnostics"] = active && diagnostics ? diagnosticSnapshot as Any? ?? NSNull() : NSNull()
    return result
  }
  private func publish() {
    guard active else { return }
    revision += 1
    emit(snapshot())
    cancelBoundary?()
    cancelBoundary = nil
    let at = now()
    var boundaries = model.segments(at).compactMap { $0["endMs"] as? Double }
    if let headingUntil = model.snapshot(at)["headingUntilMs"] as? Double { boundaries.append(headingUntil) }
    if rawEnabled, let rawAt = raw?["atMs"] as? Double { boundaries.append(rawAt + model.config.gpsFreshnessS * 1000) }
    if let next = boundaries.filter({ $0 > at + 0.01 }).min() {
      cancelBoundary = schedule((next - at) / rate) { [weak self] in
        guard let self, self.active else { return }
        self.sample(self.now(), boundary: true)
        self.publish()
      }
    }
    cancelDebug?()
    cancelDebug = nil
    let moving = model.segments(at).contains { ($0["from"] as? [Double]) != ($0["to"] as? [Double]) }
    if diagnostics || (trailEnabled && moving) {
      cancelDebug = schedule(trailEnabled && moving ? 200 : 1000) { [weak self] in
        guard let self, self.active else { return }
        self.sample(self.now())
        self.publish()
      }
    }
  }
}
