import Foundation

/// Surface-local display state. iPhone and watchOS compile this same source.
/// @parity /modules/vescape-core/src/mapDisplay.ts `MotionConfig`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/display/LiveGpsMotion.kt
struct MotionConfig: Equatable {
  var predictionStrength = 0.5
  var pointWindow = 2
  var cameraWindow = 3
  var movementM = 2.0
  var accuracyMovementRatio = 0.3
  var fullConfidenceM = 6.0
  var goodAccuracyM = 5.0
  var maxAccuracyM = 25.0
  var gpsFreshnessS = 3.0
  var directionWindowS = 8.0
  var cameraConfirmM = 3.0
  var cameraReverseConfirmM = 8.0
  var cameraConfirmFixes = 2.0
  var cameraReverseConfirmFixes = 4.0
  var telemetryFreshnessS = 1.0
  var directionRetentionS = 2.0
  var predictionHorizonS = 1.5
  var maxPredictionM = 8.0
  var recoveryAfterS = 3.0
  var recoverySpeedMps = 2.0
  var cameraPositionOmega = 3.0
  var cameraHeadingOmega = 1.0
  var arrowHeadingOmega = 10.0
  func values() -> [String: Double] {
    [
      "predictionStrength": predictionStrength,
      "maxPredictionM": maxPredictionM,
      "movementM": movementM,
      "cameraConfirmM": cameraConfirmM,
      "cameraPositionOmega": cameraPositionOmega,
      "cameraHeadingOmega": cameraHeadingOmega,
      "arrowHeadingOmega": arrowHeadingOmega
    ]
  }
  static func controls() -> [String: [String: Any]] {
    let defaults = MotionConfig().values()
    return [
      "predictionStrength": ["value": defaults["predictionStrength"]!, "min": 0.0, "max": 1.0, "step": 0.05, "unit": "fraction"],
      "maxPredictionM": ["value": defaults["maxPredictionM"]!, "min": 1.0, "max": 15.0, "step": 1.0, "unit": "m"],
      "movementM": ["value": defaults["movementM"]!, "min": 0.5, "max": 10.0, "step": 0.5, "unit": "m"],
      "cameraConfirmM": ["value": defaults["cameraConfirmM"]!, "min": 1.0, "max": 10.0, "step": 0.5, "unit": "m"],
      "cameraPositionOmega": ["value": defaults["cameraPositionOmega"]!, "min": 1.0, "max": 10.0, "step": 0.5, "unit": "rad/s"],
      "cameraHeadingOmega": ["value": defaults["cameraHeadingOmega"]!, "min": 0.1, "max": 10.0, "step": 0.1, "unit": "rad/s"],
      "arrowHeadingOmega": ["value": defaults["arrowHeadingOmega"]!, "min": 2.0, "max": 20.0, "step": 1.0, "unit": "rad/s"]
    ]
  }
  static func fromJson(_ json: String) -> MotionConfig {
    // intentional-suppression: absent or malformed session tuning uses validated defaults.
    let values = (json.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
    let metadata = controls()
    func read(_ key: String) -> Double {
      let control = metadata[key]!
      let fallback = control["value"] as! Double
      guard let value = (values[key] as? NSNumber)?.doubleValue, value.isFinite else { return fallback }
      return min(control["max"] as! Double, max(control["min"] as! Double, value))
    }
    return MotionConfig(
      predictionStrength: read("predictionStrength"),
      movementM: read("movementM"),
      cameraConfirmM: read("cameraConfirmM"),
      maxPredictionM: read("maxPredictionM"),
      cameraPositionOmega: read("cameraPositionOmega"),
      cameraHeadingOmega: read("cameraHeadingOmega"),
      arrowHeadingOmega: read("arrowHeadingOmega")
    )
  }
}
/// @parity /modules/vescape-core/src/mapDisplay.ts `MotionFix`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/display/LiveGpsMotion.kt `MotionFix`
struct MotionFix {
  var longitude: Double
  var latitude: Double
  var timestamp: Double
  var accuracyM: Double?
}
struct MotionVector {
  var x = 0.0
  var y = 0.0
  static func + (a: Self, b: Self) -> Self { Self(x: a.x + b.x, y: a.y + b.y) }
  static func * (a: Self, n: Double) -> Self { Self(x: a.x * n, y: a.y * n) }
  func dot(_ b: Self) -> Double { x * b.x + y * b.y }
  var length: Double { hypot(x, y) }
}
struct MotionDirection { var unit: MotionVector, confidence: Double, at: Double }
private struct DirectionPoint { var p: MotionVector, at: Double, accuracy: Double }
final class TravelDirection {
  private var points: [DirectionPoint] = []
  private var last: MotionDirection?
  func reset() {
    points = []
    last = nil
  }
  func update(_ p: MotionVector, accuracy: Double, now: Double, window: Int, config: MotionConfig) {
    points.removeAll { now - $0.at > config.directionWindowS * 1000 }
    guard let previous = points.last else {
      points.append(DirectionPoint(p: p, at: now, accuracy: accuracy))
      return
    }
    let displacement = p + previous.p * -1
    let distance = displacement.length
    let minimum = max(config.movementM, max(accuracy, previous.accuracy) * config.accuracyMovementRatio)
    // Meter thresholds tolerate coordinate projection roundoff (one micrometre).
    guard distance + 1e-6 >= minimum else { return }
    if let last, now - last.at < config.directionRetentionS * 1000, displacement.dot(last.unit) < 0 && distance < max(minimum, accuracy + previous.accuracy) { return }
    points.append(DirectionPoint(p: p, at: now, accuracy: accuracy))
    points = Array(points.suffix(window))
    let across = p + points[0].p * -1
    let direction = across.dot(displacement) > 0 && across.length >= minimum ? across : displacement
    last = MotionDirection(unit: direction * (1 / direction.length), confidence: min(1, distance / max(minimum, config.fullConfidenceM)), at: now)
  }
  func read(_ now: Double, config: MotionConfig) -> MotionDirection? {
    guard let last, now - last.at < config.directionRetentionS * 1000 else { return nil }
    return last
  }
}
/// Confirmed heading survives brief backwards creeping and unavailable direction.
final class CameraHeadingConfirmer {
  private let cameraDirection = TravelDirection()
  private var heldHeading: Double?
  private var cameraAnchor: MotionVector?
  private var cameraLastPosition: MotionVector?
  private var cameraCandidate: MotionVector?
  private var cameraCandidateFixes = 0
  func reset() {
    cameraDirection.reset()
    cameraAnchor = nil
    cameraLastPosition = nil
    cameraCandidate = nil
    cameraCandidateFixes = 0
  }
  func read() -> Double? { heldHeading }
  func update(_ p: MotionVector, accuracy: Double, fixAt: Double, config: MotionConfig) {
    cameraDirection.update(p, accuracy: accuracy, now: fixAt, window: config.cameraWindow, config: config)
    guard let anchor = cameraAnchor else {
      cameraAnchor = p
      cameraLastPosition = p
      return
    }
    // Count only newly accepted spatial evidence, never a retained direction at a stationary fix.
    guard let direction = cameraDirection.read(fixAt, config: config), direction.at == fixAt else { return }
    let minimum = max(config.movementM, accuracy * config.accuracyMovementRatio)
    if let candidate = cameraCandidate, let previous = cameraLastPosition {
      let step = p + previous * -1
      if step.length >= minimum && step.dot(candidate) < 0 {
        cameraCandidate = nil
        cameraCandidateFixes = 0
      }
    }
    cameraLastPosition = p
    let delta = p + anchor * -1, distance = delta.length
    // Meter thresholds tolerate coordinate projection roundoff (one micrometre).
    guard distance + 1e-6 >= minimum else { return }
    if heldHeading == nil {
      heldHeading = (atan2(direction.unit.x, direction.unit.y) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
      cameraAnchor = p
      return
    }
    if let candidate = cameraCandidate, delta.dot(candidate) < 0 && distance > minimum * 1.5 {
      cameraAnchor = p
      cameraCandidate = nil
      cameraCandidateFixes = 0
      return
    }
    cameraCandidate = delta * (1 / distance)
    cameraCandidateFixes += 1
    let heading = (atan2(direction.unit.x, direction.unit.y) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    let turn = abs((((heading - heldHeading! + 540).truncatingRemainder(dividingBy: 360)) - 180))
    let reverse = turn >= 135
    let neededDistance = reverse ? config.cameraReverseConfirmM : config.cameraConfirmM
    let neededFixes = reverse ? config.cameraReverseConfirmFixes : config.cameraConfirmFixes
    if distance + 1e-6 >= neededDistance && Double(cameraCandidateFixes) >= neededFixes {
      heldHeading = heading
      cameraAnchor = p
      cameraCandidate = nil
      cameraCandidateFixes = 0
    }
  }
}

/// Only accepted measurements become cadence anchors.
final class GpsCadenceTracker {
  private var intervals: [Double] = []
  private(set) var cadenceMs = 1000.0
  func reset() {
    intervals = []
    cadenceMs = 1000
  }
  func accept(previous: Double?, timestamp: Double, freshnessMs: Double) -> Bool {
    let interval = previous.map { timestamp - $0 } ?? 0
    let gap = previous != nil && interval > freshnessMs
    if gap { reset() }
    else if interval > 0 {
      intervals.append(interval)
      intervals = Array(intervals.suffix(5))
      cadenceMs = min(3000, max(100, intervals.sorted()[intervals.count / 2]))
    }
    return gap
  }
}

/// Braking disagreement is bounded and recoverable, with one evidence reset.
final class OvershootRecovery {
  private var contradictionAt: Double?
  private var contradictionCount = 0
  private var contradictionFix: MotionVector?
  private(set) var recovering = false
  func reset() {
    contradictionAt = nil
    contradictionCount = 0
    contradictionFix = nil
    recovering = false
  }
  func update(error: MotionVector, axis: MotionVector?, measured: MotionVector,
              accuracy: Double, now: Double, config: MotionConfig) {
    let behind = axis.map { error.dot($0) < -0.25 } ?? false
    let consistent = contradictionFix.map { (measured + $0 * -1).length <= max(1, accuracy * 0.5) } ?? false
    if behind {
      if consistent { contradictionCount += 1 } else {
        contradictionAt = now
        contradictionCount = 1
      }
      contradictionFix = measured
    } else {
      contradictionAt = nil
      contradictionCount = 0
      contradictionFix = nil
    }
    recovering = contradictionAt.map { (accuracy <= config.goodAccuracyM || contradictionCount >= 3) && now - $0 >= config.recoveryAfterS * 1000 } ?? false
  }
}

/// Continuous correction/prediction integrator. Speed/config changes preserve correction.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/display/LiveGpsMotion.kt `LiveGpsMotion`
final class LiveGpsMotion {
  private(set) var config = MotionConfig()
  private var origin: MotionFix?
  private var fix: MotionFix?
  private var p = MotionVector()
  private var time = 0.0
  private var correction = MotionVector()
  private var correctionEnd = 0.0
  private var speed = 0.0
  private var speedAt = -Double.infinity
  private var speedRevision = -Double.infinity
  private var fixAt = -Double.infinity
  private var latestFixTimestamp = -Double.infinity
  private var source = 0.0
  private var resetAt = -Double.infinity
  private let cadence = GpsCadenceTracker()
  private let pointDirection = TravelDirection()
  private let headingConfirmer = CameraHeadingConfirmer()
  private let overshoot = OvershootRecovery()
  private var predictedM = 0.0
  var recovering: Bool { overshoot.recovering }
  private var gpsUsable = true
  private var brakingAxis: MotionVector?
  var cadenceMs: Double { cadence.cadenceMs }

  func reset(source: Double, now: Double) {
    guard source >= self.source else { return }
    self.source = source
    resetAt = now
    time = now
    latestFixTimestamp = -.infinity
    origin = nil
    fix = nil
    p = MotionVector()
    correction = MotionVector()
    correctionEnd = now
    speed = 0
    speedAt = -.infinity
    speedRevision = -.infinity
    fixAt = -.infinity
    cadence.reset()
    pointDirection.reset()
    headingConfirmer.reset()
    overshoot.reset()
    predictedM = 0
    brakingAxis = nil
    gpsUsable = true
  }
  func configure(_ config: MotionConfig, now: Double) {
    advance(now)
    self.config = config
  }
  @discardableResult
  func updateSpeed(_ mps: Double?, revision: Double, receivedAt: Double, source: Double, ageMs: Double = 0) -> Bool {
    guard source == self.source, receivedAt >= resetAt, revision > speedRevision else { return false }
    advance(receivedAt); speedRevision = revision; speed = mps.map { $0.isFinite ? abs($0) : 0 } ?? 0
    speedAt = receivedAt - max(0, ageMs)
    return true
  }
  @discardableResult
  func accept(_ fix: MotionFix, receivedAt: Double, ageMs: Double, source: Double) -> Bool {
    guard source == self.source, receivedAt.isFinite, receivedAt >= resetAt,
      fix.timestamp.isFinite, fix.timestamp > latestFixTimestamp else { return false }
    latestFixTimestamp = fix.timestamp
    guard fix.longitude.isFinite, fix.latitude.isFinite,
      abs(fix.latitude) <= 85, abs(fix.longitude) <= 180,
      let accuracy = fix.accuracyM, accuracy.isFinite, accuracy >= 0, accuracy <= config.maxAccuracyM,
      ageMs.isFinite, ageMs >= 0, ageMs < config.gpsFreshnessS * 1000 else {
      advance(receivedAt)
      gpsUsable = false
      return false
    }
    advance(receivedAt)
    let previous = self.fix
    let gap = cadence.accept(previous: previous?.timestamp, timestamp: fix.timestamp, freshnessMs: config.gpsFreshnessS * 1000)
    if gap {
      pointDirection.reset()
      headingConfirmer.reset()
      brakingAxis = nil
      overshoot.reset()
    }
    if origin == nil {
      origin = fix
      p = MotionVector()
    }
    let measured = toMeters(fix)
    self.fix = fix
    gpsUsable = true
    fixAt = receivedAt - ageMs
    predictedM = 0
    pointDirection.update(measured, accuracy: accuracy, now: fixAt, window: config.pointWindow, config: config)
    headingConfirmer.update(measured, accuracy: accuracy, fixAt: fixAt, config: config)
    let direction = pointDirection.read(receivedAt, config: config)
    if let direction { brakingAxis = direction.unit }
    let error = measured + p * -1
    let axis = direction?.unit ?? brakingAxis
    overshoot.update(error: error, axis: axis, measured: measured, accuracy: accuracy, now: receivedAt, config: config)
    correction = error * (1000 / cadenceMs)
    let recoverySpeed = config.recoverySpeedMps * max(0.2, min(1, max(0, (config.maxAccuracyM - accuracy) / (config.maxAccuracyM - config.goodAccuracyM))))
    if recovering && correction.length > recoverySpeed { correction = correction * (recoverySpeed / correction.length) }
    correctionEnd = receivedAt + (recovering ? max(cadenceMs, error.length / recoverySpeed * 1000) : cadenceMs)
    if previous == nil {
      p = measured
      correction = MotionVector()
    }
    return true
  }
  private func toMeters(_ fix: MotionFix) -> MotionVector {
    let o = origin!
    return MotionVector(x: ((fix.longitude - o.longitude + 540).truncatingRemainder(dividingBy: 360) - 180) * 111320 * cos(o.latitude * .pi / 180), y: (fix.latitude - o.latitude) * 110574)
  }
  private func coordinate(_ p: MotionVector) -> (longitude: Double, latitude: Double)? {
    guard let o = origin else { return nil }
    return ((o.longitude + p.x / (111320 * cos(o.latitude * .pi / 180)) + 540).truncatingRemainder(dividingBy: 360) - 180, o.latitude + p.y / 110574)
  }
  private struct Prediction { var direction: MotionDirection?, confidence: Double, deadline: Double, velocity: MotionVector }
  private func prediction(_ now: Double, predicted: Double? = nil) -> Prediction {
    let direction = pointDirection.read(now, config: config)
    let accuracy = fix?.accuracyM ?? .infinity
    let quality = min(1, max(0, (config.maxAccuracyM - accuracy) / (config.maxAccuracyM - config.goodAccuracyM)))
    let deadline = min(fixAt + min(config.gpsFreshnessS, config.predictionHorizonS) * 1000,
      speedAt + config.telemetryFreshnessS * 1000, (direction?.at ?? -.infinity) + config.directionRetentionS * 1000)
    let confidence = quality * (direction?.confidence ?? 0)
    let enabled = now < deadline && (predicted ?? predictedM) < config.maxPredictionM - 1e-9 && !recovering && gpsUsable
    return Prediction(direction: direction, confidence: confidence, deadline: deadline,
      velocity: enabled ? direction.map { $0.unit * (speed * config.predictionStrength * confidence) } ?? MotionVector() : MotionVector())
  }
  private func project(_ now: Double) -> (p: MotionVector, predicted: Double) {
    var position = p
    var at = time
    var predicted = predictedM
    while at < now {
      let prediction = prediction(at, predicted: predicted), pv = prediction.velocity
      let predictionEnd = pv.length > 0 ? min(prediction.deadline, at + (config.maxPredictionM - predicted) / pv.length * 1000) : .infinity
      let end = min(now, correctionEnd > at ? correctionEnd : .infinity, predictionEnd)
      var velocity = (at < correctionEnd ? correction : MotionVector()) + pv
      if !recovering, let axis = brakingAxis, velocity.dot(axis) < 0 { velocity = velocity + axis * -velocity.dot(axis) }
      let dt = (end - at) / 1000
      position = position + velocity * dt
      predicted += pv.length * dt
      if end <= at { break }
      at = end
    }
    return (position, predicted)
  }
  private func advance(_ now: Double) {
    guard now > time else { return }
    if let direction = pointDirection.read(time, config: config) { brakingAxis = direction.unit }
    let next = project(now)
    p = next.p
    predictedM = next.predicted
    time = now
  }
  func isAcceptedFix(_ timestamp: Double) -> Bool { fix?.timestamp == timestamp }
  func position(_ now: Double) -> (longitude: Double, latitude: Double)? { coordinate(project(max(now, time)).p) }
  func cameraHeading(_ now: Double) -> Double? { headingConfirmer.read() }
  func pointHeading(_ now: Double) -> Double? {
    pointDirection.read(now, config: config).map { (atan2($0.unit.x, $0.unit.y) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360) }
  }
  func predictionChangeKey(_ now: Double) -> [Double] {
    let prediction = prediction(now, predicted: project(now).predicted)
    return [prediction.velocity.x, prediction.velocity.y, prediction.velocity.length > 0 ? prediction.deadline : 0]
  }
  func effectivePrediction(_ now: Double) -> Double { prediction(now).velocity.length / (speed != 0 ? speed : 1) }
  func movingUntil(_ now: Double) -> Double { max(correction.length > 0 ? correctionEnd : 0, prediction(now).velocity.length > 0 ? prediction(now).deadline : 0) }
  func segments(_ now: Double) -> [[String: Any]] {
    let state = project(max(now, time))
    let prediction = prediction(now, predicted: state.predicted)
    let budgetEnd = prediction.velocity.length > 0
      ? now + max(0, config.maxPredictionM - state.predicted) / prediction.velocity.length * 1000 : now
    let correctionBoundary = correction.length > 0 ? max(now, correctionEnd) : now
    let predictionBoundary = prediction.velocity.length > 0 ? min(prediction.deadline, budgetEnd) : now
    let boundaries = Array(Set([now, correctionBoundary, predictionBoundary].filter { $0.isFinite })).sorted()
    var segments: [[String: Any]] = zip(boundaries, boundaries.dropFirst()).compactMap { start, end in
      guard let from = position(start), let to = position(end) else { return nil }
      return ["startMs": start, "endMs": end,
        "from": [from.longitude, from.latitude], "to": [to.longitude, to.latitude]]
    }
    while let last = segments.last, (last["from"] as? [Double]) == (last["to"] as? [Double]) { segments.removeLast() }
    return segments
  }
  /// @parity /modules/vescape-core/src/mapDisplay.ts `MapDisplaySnapshot`
  func snapshot(_ now: Double) -> [String: Any] {
    let direction = pointDirection.read(now, config: config)
    return [
      "position": position(now).map { [$0.longitude, $0.latitude] } as Any? ?? NSNull(),
      "segments": segments(now), "pointHeading": pointHeading(now) as Any? ?? NSNull(),
      "headingUntilMs": direction.map { $0.at + config.directionRetentionS * 1000 } as Any? ?? NSNull(),
      "cameraHeading": cameraHeading(now) as Any? ?? NSNull()
    ]
  }
  func diagnostics(_ now: Double) -> [String: Any] {
    let prediction = prediction(now)
    let measured: [String: Any]? = fix.map { ["longitude": $0.longitude, "latitude": $0.latitude,
      "timestamp": $0.timestamp, "accuracyM": $0.accuracyM as Any? ?? NSNull()] }
    let reason: String
    if !gpsUsable { reason = "gps-unusable" }
    else if recovering { reason = "persistent-overshoot-recovery" }
    else if fix == nil { reason = "acquiring" }
    else if prediction.direction == nil { reason = "direction-unavailable" }
    else if now >= prediction.deadline { reason = "input-expired" }
    else if speed == 0 { reason = "board-stopped-or-missing" }
    else { reason = "predicting" }
    return [
      "measured": measured as Any? ?? NSNull(),
      "displayed": position(now).map { [$0.longitude, $0.latitude] } as Any? ?? NSNull(),
      "cadenceMs": cadenceMs, "confidence": prediction.confidence,
      "effectivePrediction": effectivePrediction(now),
      "directionAgeMs": prediction.direction.map { now - $0.at } as Any? ?? NSNull(),
      "recovering": recovering, "reason": reason
    ]
  }
}
