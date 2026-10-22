import Foundation

/// A display-only GPS correction plus bounded dead reckoning. Epoch milliseconds survive transport to another device.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsDisplaySmoother.kt `GpsDisplayMotion`
/// @parity /modules/vescape-core/src/index.ts `GpsDisplayMotion`
struct GpsDisplayMotion: Equatable {
  static let minimumCorrectionMs: Int64 = 100
  let fromLatitude: Double
  let fromLongitude: Double
  var toLatitude: Double
  var toLongitude: Double
  let startsAtMs: Int64
  var endsAtMs: Int64
  var resetPosition: Bool = false
  var latitudePerMs: Double = 0
  var longitudePerMs: Double = 0
  var velocityExpiresAtMs: Int64 = 0

  /// @parity /src/modules/map/lib/gpsDisplayMotion.ts `gpsDisplayPosition`
  func position(at now: Int64) -> (latitude: Double, longitude: Double) {
    let t = endsAtMs > startsAtMs ? min(1, max(0, Double(now - startsAtMs) / Double(endsAtMs - startsAtMs))) : 1
    let elapsed = Double(max(0, min(now, velocityExpiresAtMs) - startsAtMs))
    return (fromLatitude + (toLatitude - fromLatitude) * t + latitudePerMs * elapsed,
      ((fromLongitude + Self.longitudeDelta(fromLongitude, toLongitude) * t + longitudePerMs * elapsed + 540).truncatingRemainder(dividingBy: 360)) - 180)
  }

  static func longitudeDelta(_ from: Double, _ to: Double) -> Double {
    ((to - from + 540).truncatingRemainder(dividingBy: 360)) - 180
  }

  var map: [String: Any] {
    ["fromLatitude": fromLatitude, "fromLongitude": fromLongitude,
      "toLatitude": toLatitude, "toLongitude": toLongitude,
      "startsAtMs": startsAtMs, "endsAtMs": endsAtMs, "resetPosition": resetPosition, "latitudePerMs": latitudePerMs,
      "longitudePerMs": longitudePerMs, "velocityExpiresAtMs": velocityExpiresAtMs]
  }
}

/// Display estimates never replace or mutate a measured fix. GPS corrections and telemetry velocity updates have independent clocks.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsDisplaySmoother.kt `GpsDisplaySmoother`
/// @parity /modules/vescape-core/src/index.ts `GpsDisplaySettings`
final class GpsDisplaySmoother {
  private(set) var motion: GpsDisplayMotion?
  private(set) var smoothingPercent: Double
  var predictionPercent: Double

  /// @parity /src/modules/map/store/gpsDisplayStore.ts `defaults`
  init(smoothingPercent: Double = 100, predictionPercent: Double = 50) {
    self.smoothingPercent = smoothingPercent
    self.predictionPercent = predictionPercent
  }

  /// @parity /src/modules/map/components/GpsDisplayControls.tsx `GpsDisplayControls`
  @discardableResult
  func configure(smoothingPercent: Double, predictionPercent: Double, now: Int64) -> GpsDisplayMotion? {
    guard smoothingPercent.isFinite, predictionPercent.isFinite else { return motion }
    let smoothing = min(200, max(0, smoothingPercent))
    let prediction = min(100, max(0, predictionPercent))
    guard smoothing != self.smoothingPercent || prediction != self.predictionPercent else { return motion }
    self.smoothingPercent = smoothing
    self.predictionPercent = prediction
    _ = updateSpeed(speedMps: latestSpeed, timestamp: latestSpeedAt, now: now)
    if smoothing == 0, let current = motion {
      motion?.toLatitude = current.fromLatitude
      motion?.toLongitude = current.fromLongitude
      motion?.endsAtMs = now
    } else if smoothing > 0, let current = motion, current.endsAtMs > now {
      motion?.endsAtMs = now + max(GpsDisplayMotion.minimumCorrectionMs, Int64(Double(cadenceMs) * smoothing / 100))
    }
    return motion
  }
  private var lastTimestamp: Int64?
  private var intervals: [Int64] = []
  private var cadenceMs: Int64 = 1_000

  func reset() {
    motion = nil
    previousFix = nil
    direction = nil
    latestGpsAt = 0
    lastTimestamp = nil
    cadenceMs = 1_000
    intervals.removeAll(keepingCapacity: true)
  }

  /// Accurate fixes <= 2s old; cadence 100ms...5s. Gaps reset cadence, poor fixes hold display.
  /// Prediction uses the last two accurate positions and board speed fresh within one second.
  @discardableResult
  func update(latitude: Double, longitude: Double, timestamp: Int64, precise: Bool,
    accuracyM: Double?, gpsSpeedMps: Double?, courseDeg: Double?, courseTimestamp: Int64?,
    boardSpeedMps: Double?, boardSpeedTimestamp: Int64?, now: Int64) -> GpsDisplayMotion? {
    guard latitude.isFinite, longitude.isFinite, abs(latitude) <= 90, abs(longitude) <= 180,
      timestamp <= now + 250, lastTimestamp.map({ timestamp > $0 }) ?? true else { return motion }
    guard precise, let accuracyM, accuracyM.isFinite, accuracyM >= 0, accuracyM <= 25,
      now - timestamp <= 2_000 else {
      // Reject poor measurements; let the last accepted segment finish and hold its endpoint.
      intervals.removeAll(keepingCapacity: true)
      lastTimestamp = timestamp
      return motion
    }
    if let previous = lastTimestamp {
      let interval = timestamp - previous
      if interval >= 100 && interval <= 5_000 {
        intervals.append(interval)
        if intervals.count > 3 { intervals.removeFirst() }
      } else if interval > 5_000 {
        intervals.removeAll(keepingCapacity: true)
      }
    }
    if let previousFix {
      let dy = (latitude - previousFix.latitude) * .pi / 180 * 6_371_000
      let dx = GpsDisplayMotion.longitudeDelta(previousFix.longitude, longitude) * .pi / 180 * 6_371_000 * cos(latitude * .pi / 180)
      let distance = hypot(dx, dy)
      if distance >= 0.5 {
        direction = ((latitude - previousFix.latitude) / distance,
          GpsDisplayMotion.longitudeDelta(previousFix.longitude, longitude) / distance)
      }
    }
    previousFix = (latitude, longitude)
    latestGpsAt = timestamp
    lastTimestamp = timestamp
    let cadence = intervals.isEmpty ? Int64(1_000) : intervals.reduce(0, +) / Int64(intervals.count)
    cadenceMs = cadence
    return retarget(latitude: latitude, longitude: longitude, timestamp: timestamp,
      gpsSpeedMps: gpsSpeedMps, courseDeg: courseDeg, courseTimestamp: courseTimestamp,
      boardSpeedMps: boardSpeedMps, boardSpeedTimestamp: boardSpeedTimestamp, cadence: cadence, now: now)
  }

  private func retarget(latitude: Double, longitude: Double, timestamp: Int64, gpsSpeedMps: Double?,
    courseDeg: Double?, courseTimestamp: Int64?, boardSpeedMps: Double?, boardSpeedTimestamp: Int64?,
    cadence: Int64, now: Int64) -> GpsDisplayMotion? {
    let from = motion?.position(at: now) ?? (latitude: latitude, longitude: longitude)
    let duration = motion == nil || smoothingPercent == 0 ? 0 : max(GpsDisplayMotion.minimumCorrectionMs, Int64(Double(cadence) * smoothingPercent / 100))
    motion = GpsDisplayMotion(fromLatitude: duration == 0 ? latitude : from.latitude,
      fromLongitude: duration == 0 ? longitude : from.longitude,
      toLatitude: latitude, toLongitude: longitude, startsAtMs: now, endsAtMs: now + duration)
    _ = updateSpeed(speedMps: boardSpeedMps, timestamp: boardSpeedTimestamp, now: now)
    motion?.resetPosition = duration == 0
    return motion
  }

  private var previousFix: (latitude: Double, longitude: Double)?
  private var direction: (latitude: Double, longitude: Double)?
  private var latestGpsAt: Int64 = 0
  private var latestSpeed: Double?
  private var latestSpeedAt: Int64?

  /// Rebase velocity at telemetry receipt, preserving unfinished GPS correction and rendered position.
  @discardableResult
  func updateSpeed(speedMps: Double?, timestamp: Int64?, now: Int64) -> GpsDisplayMotion? {
    latestSpeed = speedMps
    latestSpeedAt = timestamp
    guard let old = motion else { return nil }
    let current = old.position(at: now)
    let remaining = old.endsAtMs > now && old.endsAtMs > old.startsAtMs
      ? Double(old.endsAtMs - now) / Double(old.endsAtMs - old.startsAtMs) : 0
    let speed = speedMps.flatMap { $0.isFinite && $0 >= 0 ? min($0, 60) : nil } ?? 0
    let expires = min(latestGpsAt + 5_000, (timestamp ?? 0) + 1_000)
    let strength = expires > now ? speed * predictionPercent / 100 / 1_000 : 0
    motion = GpsDisplayMotion(fromLatitude: current.latitude, fromLongitude: current.longitude,
      toLatitude: current.latitude + (old.toLatitude - old.fromLatitude) * remaining,
      toLongitude: ((current.longitude + GpsDisplayMotion.longitudeDelta(old.fromLongitude, old.toLongitude) * remaining + 540).truncatingRemainder(dividingBy: 360)) - 180,
      startsAtMs: now, endsAtMs: max(now, old.endsAtMs),
      latitudePerMs: (direction?.latitude ?? 0) * strength,
      longitudePerMs: (direction?.longitude ?? 0) * strength, velocityExpiresAtMs: max(now, expires))
    return motion
  }
}
