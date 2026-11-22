import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt
let WATCH_FRAME_FIELD_COUNT = 13

let WATCH_FRAME_BYTES = 2 + WATCH_FRAME_FIELD_COUNT * 4

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt `WATCH_FRAME_FLAG_STALE`
let WATCH_FRAME_FLAG_STALE = 1
let WATCH_FRAME_FLAG_WAITING = 2

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt `WatchTiltControl`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchFrame.kt `WatchTiltControl`
enum WatchTiltControl: Int, CaseIterable {
  case free = 0
  case manual = 1
  case sensor = 2
  case move = 3
  case blocked = 4

  var drivable: Bool { self == .free || self == .manual }

  init(wire: Double?) {
    guard let wire else {
      self = .free
      return
    }
    self = Self.allCases.first { Double($0.rawValue) == wire } ?? .blocked
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt `WatchFrame`
struct WatchFrame: Equatable {
  var speed: Double?
  var duty: Double?
  var battery: Double?
  var motorTemp: Double?
  var ctrlTemp: Double?
  var stale: Bool
  var waiting: Bool
  var navBearingDeg: Double?
  var navDistanceM: Double?
  var riderEastM: Double?
  var riderNorthM: Double?
  var courseDeg: Double?
  var routeSpanM: Double?
  var remoteTilt: Int?
  var tiltControl: WatchTiltControl
  var trail: [WatchTrailPoint]
  var mapPosition: WatchMapPosition?

  init(
    speed: Double? = nil,
    duty: Double? = nil,
    battery: Double? = nil,
    motorTemp: Double? = nil,
    ctrlTemp: Double? = nil,
    stale: Bool = false,
    waiting: Bool = false,
    navBearingDeg: Double? = nil,
    navDistanceM: Double? = nil,
    riderEastM: Double? = nil,
    riderNorthM: Double? = nil,
    courseDeg: Double? = nil,
    routeSpanM: Double? = nil,
    remoteTilt: Int? = nil,
    tiltControl: WatchTiltControl = .free,
    trail: [WatchTrailPoint] = [],
    mapPosition: WatchMapPosition? = nil
  ) {
    self.speed = speed
    self.duty = duty
    self.battery = battery
    self.motorTemp = motorTemp
    self.ctrlTemp = ctrlTemp
    self.stale = stale
    self.waiting = waiting
    self.navBearingDeg = navBearingDeg
    self.navDistanceM = navDistanceM
    self.riderEastM = riderEastM
    self.riderNorthM = riderNorthM
    self.courseDeg = courseDeg
    self.routeSpanM = routeSpanM
    self.remoteTilt = remoteTilt
    self.tiltControl = tiltControl
    self.trail = trail
    self.mapPosition = mapPosition
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt `WatchSnapshot`
struct WatchSnapshot {
  var speed: Double?
  var dutyCycle: Double?
  var dutyExcluded: Bool
  var batterySoc: Double?
  var motorTemp: Double?
  var ctrlTemp: Double?
  var navBearingDeg: Double?
  var navDistanceM: Double?
  var riderEastM: Double?
  var riderNorthM: Double?
  var courseDeg: Double?
  var routeSpanM: Double?
  var remoteTilt: Int?
  var tiltControl: WatchTiltControl
  var trail: [WatchTrailPoint]
  var mapPosition: WatchMapPosition?
  var riderSpeedMps: Double?

  init(
    speed: Double? = nil,
    dutyCycle: Double? = nil,
    dutyExcluded: Bool = false,
    batterySoc: Double? = nil,
    motorTemp: Double? = nil,
    ctrlTemp: Double? = nil,
    navBearingDeg: Double? = nil,
    navDistanceM: Double? = nil,
    riderEastM: Double? = nil,
    riderNorthM: Double? = nil,
    courseDeg: Double? = nil,
    routeSpanM: Double? = nil,
    remoteTilt: Int? = nil,
    tiltControl: WatchTiltControl = .free,
    trail: [WatchTrailPoint] = [],
    mapPosition: WatchMapPosition? = nil,
    riderSpeedMps: Double? = nil
  ) {
    self.speed = speed
    self.dutyCycle = dutyCycle
    self.dutyExcluded = dutyExcluded
    self.batterySoc = batterySoc
    self.motorTemp = motorTemp
    self.ctrlTemp = ctrlTemp
    self.navBearingDeg = navBearingDeg
    self.navDistanceM = navDistanceM
    self.riderEastM = riderEastM
    self.riderNorthM = riderNorthM
    self.courseDeg = courseDeg
    self.routeSpanM = routeSpanM
    self.remoteTilt = remoteTilt
    self.tiltControl = tiltControl
    self.trail = trail
    self.mapPosition = mapPosition
    self.riderSpeedMps = riderSpeedMps
  }
}

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
      navBearingDeg: snapshot.navBearingDeg,
      navDistanceM: snapshot.navDistanceM,
      riderEastM: snapshot.riderEastM,
      riderNorthM: snapshot.riderNorthM,
      courseDeg: snapshot.courseDeg,
      routeSpanM: snapshot.routeSpanM,
      remoteTilt: snapshot.remoteTilt,
      tiltControl: snapshot.tiltControl,
      trail: snapshot.trail,
      mapPosition: snapshot.mapPosition
    )
  }

  static func encode(_ frame: WatchFrame) -> Data {
    var data = Data(capacity: WATCH_FRAME_BYTES)
    data.append(UInt8(WATCH_FRAME_FIELD_COUNT))
    data.append(UInt8((frame.stale ? WATCH_FRAME_FLAG_STALE : 0) | (frame.waiting ? WATCH_FRAME_FLAG_WAITING : 0)))
    for lane in laneOrder {
      let value = Float(frame[keyPath: lane] ?? .nan)
      withUnsafeBytes(of: value.bitPattern.littleEndian) { data.append(contentsOf: $0) }
    }
    data.append(WatchTrailCodec.encode(frame.trail, position: frame.mapPosition))
    return data
  }

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
    let trail = WatchTrailCodec.decode(data, offset: WATCH_FRAME_BYTES)
    frame.trail = trail.points
    frame.mapPosition = trail.position
    return frame
  }

  private static let laneOrder: [WritableKeyPath<WatchFrame, Double?>] = [
    \.speed,
    \.duty,
    \.battery,
    \.motorTemp,
    \.ctrlTemp,
    \.navBearingDeg,
    \.navDistanceM,
    \.riderEastM,
    \.riderNorthM,
    \.courseDeg,
    \.routeSpanM,
    \.remoteTiltLane,
    \.tiltControlLane,
  ]
}

private extension WatchFrame {
  var remoteTiltLane: Double? {
    get { remoteTilt.map(Double.init) }
    set { remoteTilt = newValue.flatMap { $0.isFinite ? Int(min(max($0, 0), 255)) : nil } }
  }

  var tiltControlLane: Double? {
    get { Double(tiltControl.rawValue) }
    set { tiltControl = WatchTiltControl(wire: newValue) }
  }
}
