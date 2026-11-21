import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/RideNoticeFrame.kt `RideNoticeFrameCodec`
/// @platform-diff Android writes the bytes as a Data Layer item at `/ride-notices`. watchOS puts them
///   in the merged Application Context under ``watchRideNoticesChannel`` and, while the watch is
///   reachable, also sends them as a `sendMessage` under the same key: the context alone is
///   delivered opportunistically, which is too slow for "Rider down".
let watchRideNoticesChannel = "rideNotices"

let watchRideNoticesFrameKey = "frame"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/RideNoticeFrame.kt `WATCH_RIDE_NOTICES_VERSION`
let WATCH_RIDE_NOTICES_VERSION = 1

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/RideNoticeFrame.kt `RIDE_NOTICE_FRAME_MAX_NOTICES`
let RIDE_NOTICE_FRAME_MAX_NOTICES = 16

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/RideNoticeFrame.kt `RideNoticeFrameSeverity`
enum RideNoticeFrameSeverity: UInt8 {
  case critical = 0
  case warning = 1
  case info = 2

  init(wire: UInt8) { self = Self(rawValue: wire) ?? .warning }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/RideNoticeFrame.kt `RideNoticeFrameItem`
struct RideNoticeFrameItem: Equatable {
  var id: Int
  var rev: Int
  var severity: RideNoticeFrameSeverity
  var title: String
  var details: String
  var expiresAtMs: Int64?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/RideNoticeFrame.kt `RideNoticeFrame`
struct RideNoticeFrame: Equatable {
  var sentAtMs: Int64
  var notices: [RideNoticeFrameItem]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/RideNoticeFrame.kt `RideNoticeFrameCodec`
enum RideNoticeFrameCodec {
  private static let maxTitleBytes = 96
  private static let maxDetailsBytes = 512
  private static let noticeFixedBytes = 1 + 1 + 1 + 8 + 1 + 2

  static func encode(_ frame: RideNoticeFrame) -> Data {
    let notices = frame.notices.prefix(RIDE_NOTICE_FRAME_MAX_NOTICES)
    var data = Data()
    data.append(UInt8(WATCH_RIDE_NOTICES_VERSION))
    appendInt64(&data, frame.sentAtMs)
    data.append(UInt8(notices.count))
    for notice in notices {
      let title = utf8Prefix(notice.title, maxBytes: maxTitleBytes)
      let details = utf8Prefix(notice.details, maxBytes: maxDetailsBytes)
      appendUInt16(&data, UInt16(noticeFixedBytes + title.count + details.count))
      data.append(UInt8(truncatingIfNeeded: notice.id))
      data.append(UInt8(truncatingIfNeeded: notice.rev))
      data.append(notice.severity.rawValue)
      appendInt64(&data, notice.expiresAtMs ?? 0)
      data.append(UInt8(title.count))
      data.append(contentsOf: title)
      appendUInt16(&data, UInt16(details.count))
      data.append(contentsOf: details)
    }
    return data
  }

  static func decode(_ data: Data) -> RideNoticeFrame? {
    var reader = WatchWireReader(bytes: [UInt8](data))
    guard let version = reader.byte(), Int(version) == WATCH_RIDE_NOTICES_VERSION,
          let sentAtMs = reader.int64(), let count = reader.byte()
    else { return nil }
    var notices: [RideNoticeFrameItem] = []
    for _ in 0..<Int(count) {
      guard let recordBytes = reader.uint16() else { return nil }
      let end = reader.offset + Int(recordBytes)
      guard end <= reader.bytes.count,
            let id = reader.byte(), let rev = reader.byte(), let severity = reader.byte(),
            let expiresAtMs = reader.int64(),
            let title = reader.string(),
            let detailsLength = reader.uint16(), let details = reader.string(length: Int(detailsLength)),
            reader.offset <= end
      else { return nil }
      reader.offset = end
      notices.append(RideNoticeFrameItem(
        id: Int(id), rev: Int(rev), severity: RideNoticeFrameSeverity(wire: severity),
        title: title, details: details, expiresAtMs: expiresAtMs == 0 ? nil : expiresAtMs
      ))
    }
    return RideNoticeFrame(sentAtMs: sentAtMs, notices: notices)
  }

  private static func appendUInt16(_ data: inout Data, _ value: UInt16) {
    withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
  }

  private static func appendInt64(_ data: inout Data, _ value: Int64) {
    withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
  }
}
