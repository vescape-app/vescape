import Foundation

/// Group Ride Frame wire contract (ADR-0039): the joined Group Ride as the wrist draws it, pushed
/// about once a second as a `sendMessage` under its own key, independent of the Watch Frame.
///
/// Shared by both ends: the phone compiles this file in `vescape-core`, and `watch/watchos/`
/// symlinks it, so encoder and decoder cannot drift. The bytes are Android's layout verbatim:
///
/// ```
/// u8  version            WATCH_GROUP_RIDE_VERSION
/// f32 courseDeg          the Rider's own course, degrees clockwise from north; NaN = none yet
/// f32 spanM              horizontal metres the phone map shows
/// u8  riderCount
/// per rider:
///   u8  recordBytes      length of the rest of this record
///   u8  idBytes, utf8 id
///   u8  nameBytes, utf8 name
///   u32 colorArgb
///   f32 eastM, f32 northM   offset from the Rider's latest GPS Fix
///   u8  flags            bit 0 = stale
///   u8  batteryPercent   0-100 Battery SoC Estimate; 0xFF = none (no Board Session, or unknown)
///   u8  batteryLevel     TelemetryLevel raw value: 0 normal, 1 warning, 2 critical
///   u8  heatLevel        TelemetryLevel raw value, the worse of motor and controller temperature
///   ...                  later fields are appended here; a decoder skips what it does not know
/// ```
///
/// A new field is appended to the rider record and read only when `recordBytes` covers it, so older
/// wrists keep decoding. The version moves only for a change an older decoder must not read, which
/// it then ignores whole.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GroupRideFrameCodec`
/// @platform-diff Android sends the bytes on their own `MessageClient` path. `WCSession` has one
///   message stream, and the Watch Frame already owns `sendMessageData`, so the Group Ride Frame
///   rides `sendMessage` under ``watchGroupRideMessageKey`` instead.
let watchGroupRideMessageKey = "groupRide"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `WATCH_GROUP_RIDE_VERSION`
let WATCH_GROUP_RIDE_VERSION = 1

/// Most Riders one frame carries; the builder keeps the nearest.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GROUP_RIDE_FRAME_MAX_RIDERS`
let GROUP_RIDE_FRAME_MAX_RIDERS = 32

/// One other Rider, placed relative to the Rider wearing the watch.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GroupRideFrameRider`
struct GroupRideFrameRider: Equatable {
  var id: String
  var name: String
  /// Opaque ARGB, already resolved phone-side (chosen colour or roster fallback).
  var colorArgb: UInt32
  /// Metres east of the Rider's latest GPS Fix.
  var eastM: Double
  /// Metres north of the Rider's latest GPS Fix.
  var northM: Double
  /// No presence from this Rider for a while; still in the Group Ride.
  var stale: Bool
  /// Battery SoC Estimate, 0-100. Nil: no Board Session, or a phone too old to send it.
  var batteryPercent: Int? = nil
  /// Level of the Battery SoC Estimate, from the phone's telemetry thresholds.
  var batteryLevel: TelemetryLevel = .normal
  /// The worse of the Rider's motor and controller temperature levels.
  var heatLevel: TelemetryLevel = .normal

  /// Straight-line metres from the Rider.
  var distanceM: Double { (eastM * eastM + northM * northM).squareRoot() }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GroupRideFrame`
struct GroupRideFrame: Equatable {
  /// The Rider's own course, degrees clockwise from north. Nil until a fix carries one.
  var courseDeg: Double?
  /// Horizontal metres the phone map shows; the wrist uses the same world span.
  var spanM: Double
  /// Every other Rider with a position. Never the Rider themself.
  var riders: [GroupRideFrameRider]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GroupRideFrameCodec`
enum GroupRideFrameCodec {
  private static let maxIdBytes = 64
  private static let maxNameBytes = 32
  private static let flagStale: UInt8 = 1
  private static let noBattery: UInt8 = 0xFF
  /// Fixed part of a rider record after the two strings: colour, east, north, flags, battery, levels.
  private static let riderFixedBytes = 4 + 4 + 4 + 1 + 1 + 1 + 1

  static func encode(_ frame: GroupRideFrame) -> Data {
    let riders = frame.riders.prefix(GROUP_RIDE_FRAME_MAX_RIDERS)
    var data = Data()
    data.append(UInt8(WATCH_GROUP_RIDE_VERSION))
    appendFloat(&data, frame.courseDeg.map(Float.init) ?? .nan)
    appendFloat(&data, Float(frame.spanM))
    data.append(UInt8(riders.count))
    for rider in riders {
      let id = utf8Prefix(rider.id, maxBytes: maxIdBytes)
      let name = utf8Prefix(rider.name, maxBytes: maxNameBytes)
      data.append(UInt8(1 + id.count + 1 + name.count + riderFixedBytes))
      data.append(UInt8(id.count))
      data.append(contentsOf: id)
      data.append(UInt8(name.count))
      data.append(contentsOf: name)
      withUnsafeBytes(of: rider.colorArgb.littleEndian) { data.append(contentsOf: $0) }
      appendFloat(&data, Float(rider.eastM))
      appendFloat(&data, Float(rider.northM))
      data.append(rider.stale ? flagStale : 0)
      data.append(rider.batteryPercent.map { UInt8(min(max($0, 0), 100)) } ?? noBattery)
      data.append(rider.batteryLevel.rawValue)
      data.append(rider.heatLevel.rawValue)
    }
    return data
  }

  /// Nil for another wire version or a malformed payload: the wrist then draws no group.
  static func decode(_ data: Data) -> GroupRideFrame? {
    var reader = Reader(bytes: [UInt8](data))
    guard let version = reader.byte(), Int(version) == WATCH_GROUP_RIDE_VERSION,
          let course = reader.float(), let span = reader.float(), span.isFinite, span > 0,
          let count = reader.byte()
    else { return nil }
    var riders: [GroupRideFrameRider] = []
    for _ in 0..<Int(count) {
      guard let recordBytes = reader.byte() else { return nil }
      let end = reader.offset + Int(recordBytes)
      guard end <= reader.bytes.count,
            let id = reader.string(), let name = reader.string(),
            let color = reader.uint32(), let east = reader.float(), let north = reader.float(),
            let flags = reader.byte(),
            reader.offset <= end, east.isFinite, north.isFinite
      else { return nil }
      // Appended after the first release: an older phone's record ends before them.
      let battery = reader.offset < end ? reader.byte() ?? noBattery : noBattery
      let batteryLevel = reader.offset < end ? reader.byte() ?? 0 : 0
      let heatLevel = reader.offset < end ? reader.byte() ?? 0 : 0
      // Fields a newer phone appended: not ours to read.
      reader.offset = end
      riders.append(
        GroupRideFrameRider(
          id: id, name: name, colorArgb: color, eastM: Double(east), northM: Double(north),
          stale: flags & flagStale != 0,
          batteryPercent: battery <= 100 ? Int(battery) : nil,
          batteryLevel: TelemetryLevel(wire: batteryLevel),
          heatLevel: TelemetryLevel(wire: heatLevel)
        )
      )
    }
    return GroupRideFrame(courseDeg: course.isNaN ? nil : Double(course), spanM: Double(span), riders: riders)
  }

  private static func appendFloat(_ data: inout Data, _ value: Float) {
    withUnsafeBytes(of: value.bitPattern.littleEndian) { data.append(contentsOf: $0) }
  }

  /// The longest prefix of `value` that fits `maxBytes` of UTF-8 without splitting a character.
  private static func utf8Prefix(_ value: String, maxBytes: Int) -> [UInt8] {
    let bytes = Array(value.utf8)
    guard bytes.count > maxBytes else { return bytes }
    var end = maxBytes
    // Back off continuation bytes (10xxxxxx) so the cut lands on a character boundary.
    while end > 0, bytes[end] & 0xC0 == 0x80 { end -= 1 }
    return Array(bytes[..<end])
  }

  private struct Reader {
    let bytes: [UInt8]
    var offset = 0

    mutating func byte() -> UInt8? {
      guard offset < bytes.count else { return nil }
      defer { offset += 1 }
      return bytes[offset]
    }

    mutating func uint32() -> UInt32? {
      guard offset + 4 <= bytes.count else { return nil }
      defer { offset += 4 }
      return UInt32(bytes[offset])
        | UInt32(bytes[offset + 1]) << 8
        | UInt32(bytes[offset + 2]) << 16
        | UInt32(bytes[offset + 3]) << 24
    }

    mutating func float() -> Float? { uint32().map(Float.init(bitPattern:)) }

    mutating func string() -> String? {
      guard let length = byte(), offset + Int(length) <= bytes.count else { return nil }
      defer { offset += Int(length) }
      return String(decoding: bytes[offset..<offset + Int(length)], as: UTF8.self)
    }
  }
}
