import Foundation

/// The heading-up map's zoom and course as the wrist currently draws them, eased towards the latest
/// target. The route and the Group Ride marks all project with these numbers at the same instant, so
/// a Rider on the route stays on it mid-zoom and mid-turn.
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
  static let turnEase: TimeInterval = 0.3

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
  /// Once past this, both have landed and nothing needs to redraw.
  var settlesAt: Date { max(span.end, course.end) }

  /// Ease from wherever the map is at `now` towards `spanM` (already clamped) and `courseDeg`. A nil
  /// course holds the last one (a stop, an approximate fix). Without `animate` it lands at once.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapView.kt `rememberWatchMapView`
  mutating func retarget(spanM: Double, courseDeg: Double?, at now: Date, animate: Bool) {
    span.retarget(spanM, at: now, duration: animate ? Self.zoomEase : 0, curve: fastOutSlowIn)
    if let courseDeg {
      let from = course.value(at: now) { $0 }
      course.retarget(from + shortestAngleDelta(from: from, to: courseDeg), at: now, duration: animate ? Self.turnEase : 0) { $0 }
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
