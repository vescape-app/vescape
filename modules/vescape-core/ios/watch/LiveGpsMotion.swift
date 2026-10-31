import Foundation

/// Renderer-local display state. Never put this on the phone or the wire.
/// @parity /src/modules/map/lib/liveMotion/config.ts
/// @parity /src/modules/map/lib/liveMotion/motion.ts
/// @parity /watch/wearos/src/main/java/app/vescape/wear/LiveGpsMotion.kt
struct MotionConfig: Equatable {
  var predictionStrength = 0.5, pointWindow = 2, cameraWindow = 3
  var movementM = 2.0, accuracyMovementRatio = 0.3, fullConfidenceM = 6.0
  var goodAccuracyM = 5.0, maxAccuracyM = 25.0, gpsFreshnessS = 3.0
  var directionWindowS = 8.0
  var cameraConfirmM = 3.0, cameraReverseConfirmM = 8.0
  var cameraConfirmFixes = 2.0, cameraReverseConfirmFixes = 4.0
  var telemetryFreshnessS = 1.0, directionRetentionS = 2.0, predictionHorizonS = 1.5
  var maxPredictionM = 8.0, recoveryAfterS = 3.0, recoverySpeedMps = 2.0
  var cameraPositionOmega = 3.0, cameraHeadingOmega = 1.0, arrowHeadingOmega = 10.0
  static func fromJson(_ json: String) -> MotionConfig {
    // intentional-suppression: absent or malformed session tuning uses validated defaults.
    let values = (json.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
    func read(_ key: String, _ fallback: Double, _ minValue: Double, _ maxValue: Double) -> Double {
      guard let value = (values[key] as? NSNumber)?.doubleValue, value.isFinite else { return fallback }
      return min(maxValue, max(minValue, value))
    }
    let defaults = MotionConfig()
    return MotionConfig(
      predictionStrength: read("predictionStrength", defaults.predictionStrength, 0, 1),
      pointWindow: Int(read("pointWindow", Double(defaults.pointWindow), 2, 6).rounded()),
      cameraWindow: Int(read("cameraWindow", Double(defaults.cameraWindow), 2, 6).rounded()),
      movementM: read("movementM", defaults.movementM, 0.5, 10),
      accuracyMovementRatio: read("accuracyMovementRatio", defaults.accuracyMovementRatio, 0.1, 1),
      fullConfidenceM: read("fullConfidenceM", defaults.fullConfidenceM, 2, 20),
      goodAccuracyM: read("goodAccuracyM", defaults.goodAccuracyM, 1, 10),
      maxAccuracyM: read("maxAccuracyM", defaults.maxAccuracyM, 11, 50),
      gpsFreshnessS: read("gpsFreshnessS", defaults.gpsFreshnessS, 0.5, 10),
      directionWindowS: read("directionWindowS", defaults.directionWindowS, 3, 20),
      cameraConfirmM: read("cameraConfirmM", defaults.cameraConfirmM, 1, 10),
      cameraReverseConfirmM: read("cameraReverseConfirmM", defaults.cameraReverseConfirmM, 3, 20),
      cameraConfirmFixes: read("cameraConfirmFixes", defaults.cameraConfirmFixes, 2, 6),
      cameraReverseConfirmFixes: read("cameraReverseConfirmFixes", defaults.cameraReverseConfirmFixes, 3, 8),
      telemetryFreshnessS: read("telemetryFreshnessS", defaults.telemetryFreshnessS, 0.25, 3),
      directionRetentionS: read("directionRetentionS", defaults.directionRetentionS, 0.5, 5),
      predictionHorizonS: read("predictionHorizonS", defaults.predictionHorizonS, 0.25, 3),
      maxPredictionM: read("maxPredictionM", defaults.maxPredictionM, 1, 15),
      recoveryAfterS: read("recoveryAfterS", defaults.recoveryAfterS, 1, 6),
      recoverySpeedMps: read("recoverySpeedMps", defaults.recoverySpeedMps, 0.5, 5),
      cameraPositionOmega: read("cameraPositionOmega", defaults.cameraPositionOmega, 1, 10),
      cameraHeadingOmega: read("cameraHeadingOmega", defaults.cameraHeadingOmega, 1, 10),
      arrowHeadingOmega: read("arrowHeadingOmega", defaults.arrowHeadingOmega, 2, 20)
    )
  }
}
struct MotionFix {
  var longitude: Double, latitude: Double, timestamp: Double
  var accuracyM: Double?
}
struct MotionVector {
  var x = 0.0, y = 0.0
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
  func reset() { points = []; last = nil }
  func update(_ p: MotionVector, accuracy: Double, now: Double, window: Int, config: MotionConfig) {
    points.removeAll { now - $0.at > config.directionWindowS * 1000 }
    guard let previous = points.last else { points.append(DirectionPoint(p: p, at: now, accuracy: accuracy)); return }
    let displacement = p + previous.p * -1
    let distance = displacement.length
    let minimum = max(config.movementM, max(accuracy, previous.accuracy) * config.accuracyMovementRatio)
    // Meter thresholds tolerate coordinate projection roundoff (one micrometre).
    guard distance + 1e-6 >= minimum else { return }
    if let last, now - last.at < config.directionRetentionS * 1000, displacement.dot(last.unit) < 0 && distance < max(minimum, accuracy + previous.accuracy) { return }
    points.append(DirectionPoint(p: p, at: now, accuracy: accuracy)); points = Array(points.suffix(window))
    let across = p + points[0].p * -1
    let direction = across.dot(displacement) > 0 && across.length >= minimum ? across : displacement
    last = MotionDirection(unit: direction * (1 / direction.length), confidence: min(1, distance / max(minimum, config.fullConfidenceM)), at: now)
  }
  func read(_ now: Double, config: MotionConfig) -> MotionDirection? {
    guard let last, now - last.at < config.directionRetentionS * 1000 else { return nil }
    return last
  }
}
final class LiveGpsMotion {
  private(set) var config = MotionConfig()
  private var origin: MotionFix?, fix: MotionFix?
  private var p = MotionVector()
  private var time = 0.0
  private var correction = MotionVector()
  private var correctionEnd = 0.0
  private var speed = 0.0
  private var speedAt = -Double.infinity, speedRevision = -Double.infinity, fixAt = -Double.infinity
  private var source = 0.0, resetAt = -Double.infinity
  private var intervals: [Double] = []
  private let pointDirection = TravelDirection(), cameraDirection = TravelDirection()
  private var heldHeading: Double?, cameraAnchor: MotionVector?, cameraLastPosition: MotionVector?, cameraCandidate: MotionVector?, cameraCandidateFixes = 0, contradictionAt: Double?
  private var contradictionCount = 0
  private var contradictionFix: MotionVector?
  private var predictedM = 0.0
  private(set) var recovering = false
  private var gpsUsable = true
  private var brakingAxis: MotionVector?
  private(set) var cadenceMs = 1000.0

  func reset(source: Double, now: Double) {
    guard source >= self.source else { return }
    self.source = source; resetAt = now; time = now
    origin = nil; fix = nil; p = MotionVector(); correction = MotionVector(); correctionEnd = now
    speed = 0; speedAt = -.infinity; speedRevision = -.infinity; fixAt = -.infinity
    intervals = []; cadenceMs = 1000; pointDirection.reset(); cameraDirection.reset(); cameraAnchor = nil; cameraLastPosition = nil; cameraCandidate = nil; cameraCandidateFixes = 0
    contradictionAt = nil; contradictionCount = 0; contradictionFix = nil; predictedM = 0; recovering = false; brakingAxis = nil; gpsUsable = true
  }
  func configure(_ config: MotionConfig, now: Double) { advance(now); self.config = config }
  @discardableResult
  func updateSpeed(_ mps: Double?, revision: Double, receivedAt: Double, source: Double, ageMs: Double = 0) -> Bool {
    guard source == self.source, receivedAt >= resetAt, revision > speedRevision else { return false }
    advance(receivedAt); speedRevision = revision; speed = mps.map { $0.isFinite ? abs($0) : 0 } ?? 0
    speedAt = receivedAt - max(0, ageMs); return true
  }
  @discardableResult
  func accept(_ fix: MotionFix, receivedAt: Double, ageMs: Double, source: Double) -> Bool {
    if source == self.source, receivedAt >= resetAt, self.fix.map({ fix.timestamp > $0.timestamp }) ?? true,
      fix.accuracyM.map({ !$0.isFinite || $0 > config.maxAccuracyM }) ?? true { advance(receivedAt); gpsUsable = false }
    guard source == self.source, receivedAt >= resetAt, fix.timestamp.isFinite, fix.longitude.isFinite, fix.latitude.isFinite,
      abs(fix.latitude) <= 85, abs(fix.longitude) <= 180, let accuracy = fix.accuracyM, accuracy.isFinite, accuracy >= 0, accuracy <= config.maxAccuracyM,
      ageMs.isFinite, ageMs >= 0, ageMs < config.gpsFreshnessS * 1000, self.fix.map({ fix.timestamp > $0.timestamp }) ?? true else { return false }
    advance(receivedAt)
    let previous = self.fix
    let interval = previous.map { fix.timestamp - $0.timestamp } ?? 0
    let gap = previous != nil && interval > config.gpsFreshnessS * 1000
    if interval > 0 && !gap {
      intervals.append(interval); intervals = Array(intervals.suffix(5))
      cadenceMs = min(3000, max(100, intervals.sorted()[intervals.count / 2]))
    }
    if gap { pointDirection.reset(); cameraDirection.reset(); cameraAnchor = nil; cameraLastPosition = nil; cameraCandidate = nil; cameraCandidateFixes = 0; intervals = []; brakingAxis = nil; contradictionAt = nil; contradictionCount = 0; contradictionFix = nil; cadenceMs = 1000 }
    if origin == nil { origin = fix; p = MotionVector() }
    let measured = toMeters(fix)
    self.fix = fix; gpsUsable = true; fixAt = receivedAt - ageMs; predictedM = 0
    pointDirection.update(measured, accuracy: accuracy, now: fixAt, window: config.pointWindow, config: config)
    cameraDirection.update(measured, accuracy: accuracy, now: fixAt, window: config.cameraWindow, config: config)
    updateCameraHeading(measured, accuracy: accuracy)
    let direction = pointDirection.read(receivedAt, config: config)
    if let direction { brakingAxis = direction.unit }
    let error = measured + p * -1
    let axis = direction?.unit ?? brakingAxis
    let behind = axis.map { error.dot($0) < -0.25 } ?? false
    let consistent = contradictionFix.map { (measured + $0 * -1).length <= max(1, accuracy * 0.5) } ?? false
    if behind {
      if consistent { contradictionCount += 1 } else { contradictionAt = receivedAt; contradictionCount = 1 }
      contradictionFix = measured
    } else { contradictionAt = nil; contradictionCount = 0; contradictionFix = nil }
    recovering = contradictionAt.map { (accuracy <= config.goodAccuracyM || contradictionCount >= 3) && receivedAt - $0 >= config.recoveryAfterS * 1000 } ?? false
    correction = error * (1000 / cadenceMs)
    let recoverySpeed = config.recoverySpeedMps * max(0.2, min(1, max(0, (config.maxAccuracyM - accuracy) / (config.maxAccuracyM - config.goodAccuracyM))))
    if recovering && correction.length > recoverySpeed { correction = correction * (recoverySpeed / correction.length) }
    correctionEnd = receivedAt + (recovering ? max(cadenceMs, error.length / recoverySpeed * 1000) : cadenceMs)
    if previous == nil { p = measured; correction = MotionVector() }
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
    var position = p, at = time, predicted = predictedM
    while at < now {
      let prediction = prediction(at, predicted: predicted), pv = prediction.velocity
      let predictionEnd = pv.length > 0 ? min(prediction.deadline, at + (config.maxPredictionM - predicted) / pv.length * 1000) : .infinity
      let end = min(now, correctionEnd > at ? correctionEnd : .infinity, predictionEnd)
      var velocity = (at < correctionEnd ? correction : MotionVector()) + pv
      if !recovering, let axis = brakingAxis, velocity.dot(axis) < 0 { velocity = velocity + axis * -velocity.dot(axis) }
      let dt = (end - at) / 1000
      position = position + velocity * dt; predicted += pv.length * dt
      if end <= at { break }
      at = end
    }
    return (position, predicted)
  }
  private func advance(_ now: Double) {
    guard now > time else { return }
    if let direction = pointDirection.read(time, config: config) { brakingAxis = direction.unit }
    let next = project(now); p = next.p; predictedM = next.predicted; time = now
  }
  func position(_ now: Double) -> (longitude: Double, latitude: Double)? { coordinate(project(max(now, time)).p) }
  func cameraHeading(_ now: Double) -> Double? { heldHeading }
  private func updateCameraHeading(_ p: MotionVector, accuracy: Double) {
    guard let anchor = cameraAnchor else { cameraAnchor = p; cameraLastPosition = p; return }
    // Count only newly accepted spatial evidence, never a retained direction at a stationary fix.
    guard let direction = cameraDirection.read(fixAt, config: config), direction.at == fixAt else { return }
    let minimum = max(config.movementM, accuracy * config.accuracyMovementRatio)
    if let candidate = cameraCandidate, let previous = cameraLastPosition {
      let step = p + previous * -1
      if step.length >= minimum && step.dot(candidate) < 0 { cameraCandidate = nil; cameraCandidateFixes = 0 }
    }
    cameraLastPosition = p
    let delta = p + anchor * -1, distance = delta.length
    // Meter thresholds tolerate coordinate projection roundoff (one micrometre).
    guard distance + 1e-6 >= minimum else { return }
    if heldHeading == nil { heldHeading = (atan2(direction.unit.x, direction.unit.y) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360); cameraAnchor = p; return }
    if let candidate = cameraCandidate, delta.dot(candidate) < 0 && distance > minimum * 1.5 { cameraAnchor = p; cameraCandidate = nil; cameraCandidateFixes = 0; return }
    cameraCandidate = delta * (1 / distance); cameraCandidateFixes += 1
    let heading = (atan2(direction.unit.x, direction.unit.y) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    let turn = abs((((heading - heldHeading! + 540).truncatingRemainder(dividingBy: 360)) - 180))
    let reverse = turn >= 135
    let neededDistance = reverse ? config.cameraReverseConfirmM : config.cameraConfirmM
    let neededFixes = reverse ? config.cameraReverseConfirmFixes : config.cameraConfirmFixes
    if distance + 1e-6 >= neededDistance && Double(cameraCandidateFixes) >= neededFixes { heldHeading = heading; cameraAnchor = p; cameraCandidate = nil; cameraCandidateFixes = 0 }
  }
  func pointHeading(_ now: Double) -> Double? {
    pointDirection.read(now, config: config).map { (atan2($0.unit.x, $0.unit.y) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360) }
  }
  func effectivePrediction(_ now: Double) -> Double { prediction(now).velocity.length / (speed != 0 ? speed : 1) }
  func movingUntil(_ now: Double) -> Double { max(correction.length > 0 ? correctionEnd : 0, prediction(now).velocity.length > 0 ? prediction(now).deadline : 0) }
}
