import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GroupRideFrameCodec`
/// @platform-diff Android sends the bytes on their own `MessageClient` path. `WCSession` has one
///   message stream, and the Watch Frame already owns `sendMessageData`, so the Group Ride Frame
///   rides `sendMessage` under ``watchGroupRideMessageKey`` instead.
let watchGroupRideMessageKey = "groupRide"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `WATCH_GROUP_RIDE_VERSION`
let WATCH_GROUP_RIDE_VERSION = 1

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GROUP_RIDE_FRAME_MAX_RIDERS`
let GROUP_RIDE_FRAME_MAX_RIDERS = 32

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GroupRideFrameRider`
struct GroupRideFrameRider: Equatable {
  var id: String
  var name: String
  var colorArgb: UInt32
  var eastM: Double
  var northM: Double
  var stale: Bool
  var batteryPercent: Int? = nil
  var batteryLevel: TelemetryLevel = .normal
  var heatLevel: TelemetryLevel = .normal

  var distanceM: Double { (eastM * eastM + northM * northM).squareRoot() }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GroupRideFrame`
struct GroupRideFrame: Equatable {
  var courseDeg: Double?
  var spanM: Double
  var riders: [GroupRideFrameRider]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrame.kt `GroupRideFrameCodec`
enum GroupRideFrameCodec {
  private static let maxIdBytes = 64
  private static let maxNameBytes = 32
  private static let flagStale: UInt8 = 1
  private static let noBattery: UInt8 = 0xFF
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

  static func decode(_ data: Data) -> GroupRideFrame? {
    var reader = WatchWireReader(bytes: [UInt8](data))
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
      let battery = reader.offset < end ? reader.byte() ?? noBattery : noBattery
      let batteryLevel = reader.offset < end ? reader.byte() ?? 0 : 0
      let heatLevel = reader.offset < end ? reader.byte() ?? 0 : 0
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
}

func utf8Prefix(_ value: String, maxBytes: Int) -> [UInt8] {
  let bytes = Array(value.utf8)
  guard bytes.count > maxBytes else { return bytes }
  var end = maxBytes
  while end > 0, bytes[end] & 0xC0 == 0x80 { end -= 1 }
  return Array(bytes[..<end])
}

struct WatchWireReader {
  let bytes: [UInt8]
  var offset = 0

  mutating func byte() -> UInt8? {
    guard offset < bytes.count else { return nil }
    defer { offset += 1 }
    return bytes[offset]
  }

  mutating func uint16() -> UInt16? {
    guard offset + 2 <= bytes.count else { return nil }
    defer { offset += 2 }
    return UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
  }

  mutating func uint32() -> UInt32? {
    guard offset + 4 <= bytes.count else { return nil }
    defer { offset += 4 }
    return UInt32(bytes[offset])
      | UInt32(bytes[offset + 1]) << 8
      | UInt32(bytes[offset + 2]) << 16
      | UInt32(bytes[offset + 3]) << 24
  }

  mutating func int64() -> Int64? {
    guard let low = uint32(), let high = uint32() else { return nil }
    return Int64(bitPattern: UInt64(high) << 32 | UInt64(low))
  }

  mutating func float() -> Float? { uint32().map(Float.init(bitPattern:)) }

  mutating func string(length: Int) -> String? {
    guard offset + length <= bytes.count else { return nil }
    defer { offset += length }
    return String(decoding: bytes[offset..<offset + length], as: UTF8.self)
  }

  mutating func string() -> String? {
    guard let length = byte() else { return nil }
    return string(length: Int(length))
  }
}
