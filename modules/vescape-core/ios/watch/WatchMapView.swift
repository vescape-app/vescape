import Foundation

/// The heading-up map's position, zoom and course as the wrist currently draws them, eased towards the latest
/// target. Route and trail share position motion; Group Ride shares zoom and course.
/// Both paths sample one camera translation at each instant.
///
/// A value, read at a date: the wrist's map layers each sample it on their own `TimelineView`, which
/// only runs while `settlesAt` is ahead. Shared with the wrist (`watch/watchos/` symlinks this file)
/// so the easing is tested here.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `WatchMapView`
/// @platform-diff Wear OS eases with Compose `Animatable`s. Here a `Canvas` cannot read a shape's
///   `animatableData`, so the map interpolates explicitly and every layer reads the same function.
struct WatchMapView: Equatable {
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `MAP_ZOOM_EASE_MS`
  static let zoomEase: TimeInterval = 0.35
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `MAP_TURN_EASE_MS`
  static let turnEase: TimeInterval = 3 / MotionConfig().cameraHeadingOmega

  private(set) var motion = WatchMapMotion()
  private var span: Ease
  /// Unwrapped, so a heading crossing north turns the short way; `relativeBearingDeg` wraps it.
  private var course: Ease

  /// Settled at `spanM` (already clamped) and `courseDeg`, 0 (north-up) when there is none yet.
  init(spanM: Double, courseDeg: Double?) {
    span = Ease(settledAt: spanM)
    course = Ease(settledAt: courseDeg ?? 0)
  }

  /// Metres across the display at `date`.
  func spanM(at date: Date) -> Double { span.value(at: date, curve: fastOutSlowIn) }
  /// Unwrapped course at `date`.
  func courseDeg(at date: Date) -> Double { course.value(at: date) { $0 } }
  /// Once past this, all movement has landed and nothing needs to redraw.
  var settlesAt: Date { max(span.end, course.end, motion.endsAt) }

  /// Ease from wherever the map is at `now` towards `spanM` (already clamped) and `courseDeg`. A nil
  /// course holds the last one (a stop, an approximate fix). Without `animate` it lands at once.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `rememberWatchMapView`
  mutating func retarget(spanM: Double, courseDeg: Double?, at now: Date, animate: Bool, position: WatchMapPosition? = nil, facts: WatchMotionFacts? = nil, speed: Double? = nil, config: MotionConfig = MotionConfig()) {
    var heading = courseDeg
    if let facts, let position, animate {
      let display = motion.display ?? WatchDisplayMotion()
      display.configure(config, local: now.timeIntervalSince1970 * 1000)
      if display.accept(position, facts: facts, speed: speed, now: now.timeIntervalSince1970 * 1000) {
        if display.position(now.timeIntervalSince1970 * 1000) == nil {
          motion = motion.retarget(position, at: now, animate: animate)
          return
        }
        let previousEnd = motion.endsAt
        motion = WatchMapMotion(position: position, display: display)
        motion.endsAt = max(previousEnd, Date(timeIntervalSince1970: (display.movingUntil(now.timeIntervalSince1970 * 1000) + 3000) / 1000))
      }
      heading = display.heading(now.timeIntervalSince1970 * 1000)
    } else { motion = motion.retarget(position, at: now, animate: animate) }
    span.retarget(spanM, at: now, duration: animate ? Self.zoomEase : 0, curve: fastOutSlowIn)
    if let courseDeg = heading {
      let from = course.value(at: now) { $0 }
      course.retarget(from + shortestAngleDelta(from: from, to: courseDeg), at: now, duration: animate ? 3 / config.cameraHeadingOmega : 0) { $0 }
    }
  }
}

/// One eased number: `from` at `start`, `to` at `end`.
private struct Ease: Equatable {
  var from: Double
  var to: Double
  var start: Date
  var end: Date

  init(settledAt value: Double) {
    from = value
    to = value
    start = .distantPast
    end = .distantPast
  }

  func value(at date: Date, curve: (Double) -> Double) -> Double {
    guard date < end, end > start else { return to }
    let t = max(0, date.timeIntervalSince(start) / end.timeIntervalSince(start))
    return from + (to - from) * curve(t)
  }

  /// Zero `duration` lands at once, also mid-ease towards the same target.
  mutating func retarget(_ target: Double, at now: Date, duration: TimeInterval, curve: (Double) -> Double) {
    if duration <= 0 {
      self = Ease(settledAt: target)
      return
    }
    guard target != to else { return }
    from = value(at: now, curve: curve)
    to = target
    start = now
    end = now.addingTimeInterval(duration)
  }
}

/// Material's fast-out-slow-in, cubic-bezier(0.4, 0, 0.2, 1): Compose's `FastOutSlowInEasing`, so
/// both wrists zoom on the same curve.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `zoomTo`
func fastOutSlowIn(_ t: Double) -> Double {
  let t = min(max(t, 0), 1)
  // Solve x(u) = t by bisection (x is monotonic), then read y(u).
  func bezier(_ u: Double, _ p1: Double, _ p2: Double) -> Double {
    let v = 1 - u
    return 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u
  }
  var low = 0.0
  var high = 1.0
  for _ in 0..<24 {
    let mid = (low + high) / 2
    if bezier(mid, 0.4, 0.2) < t { low = mid } else { high = mid }
  }
  return bezier((low + high) / 2, 0, 1)
}

/// Shortest turn between two compass headings, in degrees, signed.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `shortestAngleDelta`
func shortestAngleDelta(from: Double, to: Double) -> Double {
  (((to - from + 180).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)) - 180
}

/// Remaining camera translation relative to the latest GPS fix. One clock for both paths.
/// The absolute anchor survives rerouting, history trimming and skipped frames.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `WatchMapMotion`
struct WatchMapMotion: Equatable {
  var position: WatchMapPosition?
  var display: WatchDisplayMotion?
  init(position: WatchMapPosition? = nil, display: WatchDisplayMotion? = nil) { self.position = position; self.display = display }
  private var from = WatchTrailPoint(eastM: 0, northM: 0)
  private var startsAt = Date.distantPast
  fileprivate(set) var endsAt = Date.distantPast

  func offset(at date: Date) -> WatchTrailPoint {
    if let display {
      // Settled timelines use distantFuture; land there without integrating an artificial clock.
      if date == .distantFuture {
        return display.offset(endsAt.timeIntervalSince1970 * 1000)
      }
      return display.offset(date.timeIntervalSince1970 * 1000)
    }
    let remaining = endsAt > startsAt ? min(1, max(0, endsAt.timeIntervalSince(date) / endsAt.timeIntervalSince(startsAt))) : 0
    return WatchTrailPoint(eastM: from.eastM * remaining, northM: from.northM * remaining)
  }

  func retarget(_ target: WatchMapPosition?, at now: Date, animate: Bool) -> WatchMapMotion {
    guard animate, let target, let position else { return WatchMapMotion(position: target) }
    guard target != position else { return self }
    let movement = target.offset(from: position)
    let remaining = offset(at: now)
    var next = WatchMapMotion(position: target)
    next.from = WatchTrailPoint(eastM: remaining.eastM + movement.eastM, northM: remaining.northM + movement.northM)
    next.startsAt = now
    next.endsAt = now.addingTimeInterval(0.3)
    return next
  }
}

/// Grow the newest segment from the pinned rider while history moves with the camera.
/// Trim at most the pending camera distance from the newest suffix, then pin the tip to the ring.
/// Direction alone cannot identify new points: older history may be ahead after a U-turn.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `movingTrail`
func movingTrail(_ points: [WatchTrailPoint], offset: WatchTrailPoint) -> [WatchTrailPoint] {
  let shifted = points.map { WatchTrailPoint(eastM: $0.eastM + offset.eastM, northM: $0.northM + offset.northM) }
  guard let tip = points.last, hypot(tip.eastM, tip.northM) <= 0.01 else { return shifted }
  var end = points.count - 1
  var remaining = hypot(offset.eastM, offset.northM)
  // Always retain the oldest point. A short/sampled history must not vanish during motion.
  while end > 1 {
    let segment = hypot(points[end].eastM - points[end - 1].eastM, points[end].northM - points[end - 1].northM)
    if segment > remaining { break }
    remaining -= segment
    end -= 1
  }
  return Array(shifted.prefix(end)) + [WatchTrailPoint(eastM: 0, northM: 0)]
}

/// Thin measured-frame adapter. The controller alone integrates correction/prediction; camera
/// response stays local and deliberately slower than the point.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `WatchDisplayMotion`
final class WatchDisplayMotion: Equatable {
  static func == (a: WatchDisplayMotion, b: WatchDisplayMotion) -> Bool { a === b }
  let model = LiveGpsMotion()
  private let clock = WatchMotionClock()
  private var source = -1.0
  private var localAnchor = 0.0, displayAnchor = 0.0, rate = 1.0
  private func displayNow(_ local: Double) -> Double { displayAnchor + (local - localAnchor) * rate }
  func position(_ local: Double) -> (longitude: Double, latitude: Double)? { model.position(displayNow(local)) }
  func heading(_ local: Double) -> Double? { model.cameraHeading(displayNow(local)) }
  func movingUntil(_ local: Double) -> Double { let at = displayNow(local); return local + (model.movingUntil(at) - at) / rate }
  func configure(_ config: MotionConfig, local: Double) { model.configure(config, now: displayNow(local)) }
  private(set) var anchor: WatchMapPosition?
  private var camera: MotionVector?, origin: WatchMapPosition?
  private var velocity = MotionVector(), lastTarget = MotionVector()
  private var time = 0.0

  @discardableResult
  func accept(_ position: WatchMapPosition, facts: WatchMotionFacts, speed: Double?, now: Double) -> Bool {
    guard let delay = clock.accept(facts, now: now) else { return false }
    let at = displayNow(now)
    displayAnchor = at; localAnchor = now; rate = facts.clockRate
    if facts.sourceId != source {
      source = facts.sourceId; model.reset(source: source, now: at); camera = nil; origin = position
    }
    model.accept(MotionFix(longitude: position.longitude, latitude: position.latitude, timestamp: facts.fixTimestamp, accuracyM: facts.accuracyM), receivedAt: at, ageMs: facts.gpsAgeMs + delay * rate, source: source)
    model.updateSpeed(speed.map { $0 / 3.6 }, revision: facts.sentAt, receivedAt: at, source: source, ageMs: facts.boardAgeMs + delay * rate)
    anchor = position
    return true
  }
  private func sample(_ now: Double) -> (point: MotionVector, camera: MotionVector) {
    guard let coordinate = position(now), let origin else { return (MotionVector(), MotionVector()) }
    let point = WatchMapPosition(latitude: coordinate.latitude, longitude: coordinate.longitude).offset(from: origin)
    let target = MotionVector(x: point.eastM, y: point.northM)
    guard let current = camera else { camera = target; lastTarget = target; time = now; return (target, target) }
    let dt = (now - time) / 1000
    guard dt > 0 else { return (target, current) }
    let omega = model.config.cameraPositionOmega
    let ramp = (target + lastTarget * -1) * (1 / dt)
    let a = current + lastTarget * -1 + ramp * (2 / omega)
    let b = velocity + ramp * -1 + a * omega
    let decay = exp(-omega * dt)
    let next = target + ramp * (-2 / omega) + (a + b * dt) * decay
    velocity = ramp + (b + (a + b * dt) * -omega) * decay
    camera = next; lastTarget = target; time = now
    return (target, next)
  }
  func offset(_ now: Double) -> WatchTrailPoint {
    guard let origin, let anchor else { return WatchTrailPoint(eastM: 0, northM: 0) }
    let camera = sample(now).camera, anchorOffset = anchor.offset(from: origin)
    return WatchTrailPoint(eastM: anchorOffset.eastM - camera.x, northM: anchorOffset.northM - camera.y)
  }
  func riderOffset(_ now: Double) -> WatchTrailPoint {
    let (point, camera) = sample(now)
    return WatchTrailPoint(eastM: point.x - camera.x, northM: point.y - camera.y)
  }
}
