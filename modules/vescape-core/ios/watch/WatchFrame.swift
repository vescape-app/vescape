import Foundation

/// Number of Float32 lanes in a Watch Frame, in this fixed order:
///   0 speed, 1 duty, 2 battery, 3 motorTemp, 4 ctrlTemp, 5 navBearing, 6 navDistance,
///   7 riderEast, 8 riderNorth, 9 course, 10 routeSpan.
///
/// Lanes 5-10 are navigation and route placement. The iOS phone side does not fill them yet (#486
/// onwards); they ride as `NaN`, which is exactly how the wrist already hides its nav overlay, so
/// the wire format is the Android one from the first frame rather than something to widen later.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt
let WATCH_FRAME_FIELD_COUNT = 11

/// Header (1 byte field-count + 1 byte flags) + Float32 lanes, little-endian.
let WATCH_FRAME_BYTES = 2 + WATCH_FRAME_FIELD_COUNT * 4

/// Flags-byte bits. This phone side never sets "waiting" — the tick is session scoped and always
/// has a frame worth drawing — but the decoder still reads it, because it is part of the wire
/// format and a decoder that drops a defined bit is how a legacy phone ends up rendering its empty
/// lanes as real readings.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt `WATCH_FRAME_FLAG_STALE`
let WATCH_FRAME_FLAG_STALE = 1
let WATCH_FRAME_FLAG_WAITING = 2

/// The decoded Watch Frame model. Nullable numeric lanes ride as `NaN` over the wire (ADR-0018).
///
/// Unlike Android — where the phone encoder and the wrist decoder carry the lane order twice, by
/// convention — this file is symlinked into `watch/watchos/`, so both sides compile the *same*
/// source. Lane drift between phone and wrist is not a review risk on this platform; changing a
/// lane here changes both ends at once.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt `WatchFrame`
struct WatchFrame: Equatable {
  var speed: Double?
  var duty: Double?
  var battery: Double?
  var motorTemp: Double?
  var ctrlTemp: Double?
  var stale: Bool
  /// "Session live, no board telemetry yet" — a legacy Android phone frame whose lanes carry no
  /// data. `MirrorStateReducer` empties them; nothing downstream re-checks the flag.
  var waiting: Bool
  /// Where the path goes next: absolute degrees clockwise from north, from Route Progress. The
  /// wrist rotates its north-up world by `courseDeg`, so this is never pre-rotated on the phone.
  /// Null whenever there is no Navigation, which is how the wrist hides its nav overlay.
  var navBearing: Double?
  /// Metres left to the Direction Point measured **along** the path. Null with `navBearing`.
  var navDistanceM: Double?
  /// Rider position, metres east of the pushed route's origin. Null when there is no route.
  var riderEastM: Double?
  /// Rider position, metres north of the pushed route's origin. Null when there is no route.
  var riderNorthM: Double?
  /// Travel course, degrees clockwise from north. Null when the fix carries no usable heading.
  var courseDeg: Double?
  /// Horizontal metres visible on the phone map; wrist route uses the same world span.
  var routeSpanM: Double?

  init(
    speed: Double? = nil,
    duty: Double? = nil,
    battery: Double? = nil,
    motorTemp: Double? = nil,
    ctrlTemp: Double? = nil,
    stale: Bool = false,
    waiting: Bool = false,
    navBearing: Double? = nil,
    navDistanceM: Double? = nil,
    riderEastM: Double? = nil,
    riderNorthM: Double? = nil,
    courseDeg: Double? = nil,
    routeSpanM: Double? = nil
  ) {
    self.speed = speed
    self.duty = duty
    self.battery = battery
    self.motorTemp = motorTemp
    self.ctrlTemp = ctrlTemp
    self.stale = stale
    self.waiting = waiting
    self.navBearing = navBearing
    self.navDistanceM = navDistanceM
    self.riderEastM = riderEastM
    self.riderNorthM = riderNorthM
    self.courseDeg = courseDeg
    self.routeSpanM = routeSpanM
  }
}

/// The latest cold-path values the watch tick reads to build a frame. `stale` is decided at tick time.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt `WatchSnapshot`
struct WatchSnapshot {
  var speed: Double?
  var dutyCycle: Double?
  var dutyExcluded: Bool
  var batterySoc: Double?
  var motorTemp: Double?
  var ctrlTemp: Double?
  var navBearing: Double?
  var navDistanceM: Double?
  var riderEastM: Double?
  var riderNorthM: Double?
  var courseDeg: Double?
  var routeSpanM: Double?

  init(
    speed: Double? = nil,
    dutyCycle: Double? = nil,
    dutyExcluded: Bool = false,
    batterySoc: Double? = nil,
    motorTemp: Double? = nil,
    ctrlTemp: Double? = nil,
    navBearing: Double? = nil,
    navDistanceM: Double? = nil,
    riderEastM: Double? = nil,
    riderNorthM: Double? = nil,
    courseDeg: Double? = nil,
    routeSpanM: Double? = nil
  ) {
    self.speed = speed
    self.dutyCycle = dutyCycle
    self.dutyExcluded = dutyExcluded
    self.batterySoc = batterySoc
    self.motorTemp = motorTemp
    self.ctrlTemp = ctrlTemp
    self.navBearing = navBearing
    self.navDistanceM = navDistanceM
    self.riderEastM = riderEastM
    self.riderNorthM = riderNorthM
    self.courseDeg = courseDeg
    self.routeSpanM = routeSpanM
  }
}

/// Pure cold-path-snapshot -> Watch Frame builder, byte encoder, and wrist-side decoder (ADR-0019).
/// Mirrors `LIVE_SERIES_METRICS`: speed/duty are abs (duty also ×100), and duty drops to null when
/// the sample is excluded from `max_duty`, so the wrist shows the same numbers the phone does.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt `WatchFrameBuilder`
enum WatchFrameBuilder {
  static func build(snapshot: WatchSnapshot, stale: Bool) -> WatchFrame {
    WatchFrame(
      speed: snapshot.speed.map(abs),
      duty: snapshot.dutyExcluded ? nil : snapshot.dutyCycle.map { abs($0) * 100 },
      battery: snapshot.batterySoc,
      motorTemp: snapshot.motorTemp,
      ctrlTemp: snapshot.ctrlTemp,
      stale: stale,
      navBearing: snapshot.navBearing,
      navDistanceM: snapshot.navDistanceM,
      riderEastM: snapshot.riderEastM,
      riderNorthM: snapshot.riderNorthM,
      courseDeg: snapshot.courseDeg,
      routeSpanM: snapshot.routeSpanM
    )
  }

  static func encode(_ frame: WatchFrame) -> Data {
    var data = Data(capacity: WATCH_FRAME_BYTES)
    data.append(UInt8(WATCH_FRAME_FIELD_COUNT))
    data.append(UInt8((frame.stale ? WATCH_FRAME_FLAG_STALE : 0) | (frame.waiting ? WATCH_FRAME_FLAG_WAITING : 0)))
    for lane in laneOrder {
      // Nullable lanes ride as NaN; nav lanes do so whenever there is no Navigation, which is how
      // the wrist hides the overlay.
      let value = Float(frame[keyPath: lane] ?? .nan)
      withUnsafeBytes(of: value.bitPattern.littleEndian) { data.append(contentsOf: $0) }
    }
    return data
  }

  /// Wrist-side decode. Returns nil for anything that is not a frame this build understands: a
  /// truncated message, or a phone encoding a different lane count than this binary was built with.
  static func decode(_ data: Data) -> WatchFrame? {
    guard data.count >= WATCH_FRAME_BYTES else { return nil }
    let bytes = [UInt8](data)
    guard Int(bytes[0]) == WATCH_FRAME_FIELD_COUNT else { return nil }
    var frame = WatchFrame(
      stale: Int(bytes[1]) & WATCH_FRAME_FLAG_STALE != 0,
      waiting: Int(bytes[1]) & WATCH_FRAME_FLAG_WAITING != 0
    )
    for (index, lane) in laneOrder.enumerated() {
      let offset = 2 + index * 4
      let raw = UInt32(bytes[offset])
        | UInt32(bytes[offset + 1]) << 8
        | UInt32(bytes[offset + 2]) << 16
        | UInt32(bytes[offset + 3]) << 24
      let value = Float(bitPattern: raw)
      frame[keyPath: lane] = value.isNaN ? nil : Double(value)
    }
    return frame
  }

  /// The lane order, written once. Encoding and decoding disagreeing about it is the one corruption
  /// this format cannot detect, so both walk this list rather than restating the order.
  private static let laneOrder: [WritableKeyPath<WatchFrame, Double?>] = [
    \.speed,
    \.duty,
    \.battery,
    \.motorTemp,
    \.ctrlTemp,
    \.navBearing,
    \.navDistanceM,
    \.riderEastM,
    \.riderNorthM,
    \.courseDeg,
    \.routeSpanM,
  ]
}
