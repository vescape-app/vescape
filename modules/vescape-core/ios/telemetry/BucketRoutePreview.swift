import Foundation
import GRDB

/// Derived thumbnail geometry. route_preview stores JSON segments [firstFixMs,lastFixMs,polyline],
/// with signed delta-varint polyline coordinates at E7 precision. NULL means not generated yet.
/// Always simplify original fixes, never an earlier preview. Endpoints survive every simplification.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BucketRoutePreview.kt
internal enum BucketRoutePreview {
  static let gapMs: Int64 = 30_000
  private static let toleranceM = 5.0
  private static let metresPerE7 = 6_371_000.0 * Double.pi / 180.0 / 10_000_000.0

  struct Coordinate: Equatable { let latitudeE7: Int64; let longitudeE7: Int64 }
  struct Segment: Equatable { let firstAtMs: Int64; let lastAtMs: Int64; let points: [Coordinate] }
  enum InvalidPreview: Error { case malformed }

  static func build(_ track: [RideTrackPoint]) throws -> String {
    var segments: [[RideTrackPoint]] = []
    for point in track.filter(rideTrackFixIsPrecise).sorted(by: { $0.fixAtMs < $1.fixAtMs }) {
      if let previous = segments.last?.last {
        if point.fixAtMs - previous.fixAtMs > gapMs || point.recordingId != previous.recordingId || point.boardId != previous.boardId {
          segments.append([])
        }
      } else { segments.append([]) }
      segments[segments.count - 1].append(point)
    }
    let values: [[Any]] = segments.map { segment in
      let coordinates = segment.map { Coordinate(latitudeE7: $0.latitudeE7, longitudeE7: $0.longitudeE7) }
      return [segment.first!.fixAtMs, segment.last!.fixAtMs, encode(simplify(coordinates))]
    }
    return String(decoding: try JSONSerialization.data(withJSONObject: values, options: [.withoutEscapingSlashes]), as: UTF8.self)
  }

  static func decode(_ value: String) throws -> [Segment] {
    guard let array = try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [[Any]] else { throw InvalidPreview.malformed }
    return try array.map { segment in
      guard segment.count == 3, let first = segment[0] as? NSNumber, let last = segment[1] as? NSNumber,
        let polyline = segment[2] as? String else { throw InvalidPreview.malformed }
      return Segment(firstAtMs: first.int64Value, lastAtMs: last.int64Value, points: try decodePolyline(polyline))
    }
  }

  private static func simplify(_ points: [Coordinate]) -> [Coordinate] {
    guard points.count >= 3 else { return points }
    let longitudeScale = cos(Double(points[0].latitudeE7) * .pi / 180.0 / 10_000_000.0)
    var keep = Array(repeating: false, count: points.count)
    keep[0] = true; keep[points.count - 1] = true
    var pending = [(0, points.count - 1)]
    while let (first, last) = pending.popLast() {
      let a = points[first], b = points[last]
      let dx = Double(b.longitudeE7 - a.longitudeE7) * longitudeScale * metresPerE7
      let dy = Double(b.latitudeE7 - a.latitudeE7) * metresPerE7
      let lengthSquared = dx * dx + dy * dy
      var furthest: Int?
      var maximum = toleranceM * toleranceM
      for index in (first + 1)..<last {
        let point = points[index]
        let x = Double(point.longitudeE7 - a.longitudeE7) * longitudeScale * metresPerE7
        let y = Double(point.latitudeE7 - a.latitudeE7) * metresPerE7
        let t = lengthSquared == 0 ? 0 : min(1, max(0, (x * dx + y * dy) / lengthSquared))
        let distance = (x - t * dx) * (x - t * dx) + (y - t * dy) * (y - t * dy)
        if distance > maximum { maximum = distance; furthest = index }
      }
      if let furthest {
        keep[furthest] = true
        pending.append((first, furthest)); pending.append((furthest, last))
      }
    }
    return points.enumerated().compactMap { keep[$0.offset] ? $0.element : nil }
  }

  private static func encode(_ points: [Coordinate]) -> String {
    var bytes: [UInt8] = []
    var latitude: Int64 = 0, longitude: Int64 = 0
    func appendDelta(_ delta: Int64) {
      var value = (delta << 1) ^ (delta >> 63)
      while value >= 32 { bytes.append(UInt8((value & 31) | 32) + 63); value >>= 5 }
      bytes.append(UInt8(value) + 63)
    }
    for point in points {
      appendDelta(point.latitudeE7 - latitude); appendDelta(point.longitudeE7 - longitude)
      latitude = point.latitudeE7; longitude = point.longitudeE7
    }
    return String(decoding: bytes, as: UTF8.self)
  }

  private static func decodePolyline(_ value: String) throws -> [Coordinate] {
    let bytes = Array(value.utf8)
    var offset = 0
    func delta() throws -> Int64 {
      var result: Int64 = 0, shift = 0
      while true {
        guard offset < bytes.count, shift <= 35 else { throw InvalidPreview.malformed }
        let byte = Int64(bytes[offset]) - 63; offset += 1
        guard (0...63).contains(byte) else { throw InvalidPreview.malformed }
        result |= (byte & 31) << shift
        if byte < 32 { return (result >> 1) ^ -(result & 1) }
        shift += 5
      }
    }
    var points: [Coordinate] = []
    var latitude: Int64 = 0, longitude: Int64 = 0
    while offset < bytes.count {
      latitude += try delta(); longitude += try delta()
      guard (-900_000_000...900_000_000).contains(latitude), (-1_800_000_000...1_800_000_000).contains(longitude) else { throw InvalidPreview.malformed }
      points.append(Coordinate(latitudeE7: latitude, longitudeE7: longitude))
    }
    guard !points.isEmpty else { throw InvalidPreview.malformed }
    return points
  }
}

/// Called inside recording/rebuild transactions after their raw fixes have been inserted.
/// Re-read one indexed minute, so restarts and late fixes need no separate cache recovery.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `refreshBucketRoutePreview`
internal func refreshBucketRoutePreview(_ db: Database, bucketStartMs: Int64, boardId: String, recordingId: String) throws {
  let rows = try Row.fetchAll(db, sql: """
    SELECT * FROM ride_track_points WHERE fix_at_ms >= ? AND fix_at_ms < ?
      AND board_id IS ? AND recording_id IS ? ORDER BY fix_at_ms, id
    """, arguments: [bucketStartMs, bucketStartMs + TELEMETRY_BUCKET_SIZE_MS,
      boardId == UNKNOWN_TELEMETRY_BOARD_ID ? nil : boardId,
      recordingId == LEGACY_RIDE_RECORDING_ID ? nil : recordingId])
  let points = rows.map(rideTrackPoint)
  try db.execute(sql: """
    UPDATE telemetry_minute_buckets SET route_preview = ?
    WHERE bucket_start_ms = ? AND board_id = ? AND recording_id = ?
    """, arguments: [try BucketRoutePreview.build(points), bucketStartMs, boardId, recordingId])
}

/// Full minutes reuse previews; only trimmed edge minutes need original fixes for exact boundaries.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BucketRoutePreview.kt `favoriteRoutePreview`
internal func favoriteRoutePreview(_ db: Database, startMs: Int64, endMs: Int64, boardId: String?) throws -> [[String: Any]] {
  let buckets = try Row.fetchAll(db, sql: """
    SELECT * FROM telemetry_minute_buckets
    WHERE board_id = ? AND bucket_start_ms >= ? AND bucket_start_ms <= ?
    ORDER BY first_sample_at_ms, bucket_start_ms, recording_id
    """, arguments: [boardId ?? UNKNOWN_TELEMETRY_BOARD_ID, startMs - startMs % TELEMETRY_BUCKET_SIZE_MS, endMs])
  var result: [[String: Any]] = []
  var previousEnd: Int64?
  var previousRecording: String?
  for bucket in buckets {
    let minuteStart: Int64 = bucket["bucket_start_ms"]
    let minuteEnd = minuteStart + TELEMETRY_BUCKET_SIZE_MS
    let recording: String = bucket["recording_id"]
    let preview: String? = bucket["route_preview"]
    let segments: [BucketRoutePreview.Segment]
    if startMs > minuteStart || endMs < minuteEnd - 1 {
      let rows = try Row.fetchAll(db, sql: """
        SELECT * FROM ride_track_points WHERE fix_at_ms >= ? AND fix_at_ms < ?
          AND board_id IS ? AND recording_id IS ? ORDER BY fix_at_ms, id
        """, arguments: [max(startMs, minuteStart), min(endMs, minuteEnd - 1) + 1,
          boardId, recording == LEGACY_RIDE_RECORDING_ID ? nil : recording])
      segments = try BucketRoutePreview.decode(BucketRoutePreview.build(rows.map(rideTrackPoint)))
    } else if let preview { segments = try BucketRoutePreview.decode(preview) }
    else if let latitude: Int64 = bucket["first_latitude_e7"], let longitude: Int64 = bucket["first_longitude_e7"] {
      segments = [BucketRoutePreview.Segment(firstAtMs: bucket["first_sample_at_ms"], lastAtMs: bucket["last_sample_at_ms"],
        points: [BucketRoutePreview.Coordinate(latitudeE7: latitude, longitudeE7: longitude)])]
    } else { segments = [] }
    for (segmentIndex, segment) in segments.enumerated() {
      let gap = previousEnd.map { segmentIndex > 0 || segment.firstAtMs - $0 > BucketRoutePreview.gapMs || previousRecording != recording } ?? false
      for (index, point) in segment.points.enumerated() {
        var value: [String: Any] = ["latitude": Double(point.latitudeE7) / 1e7, "longitude": Double(point.longitudeE7) / 1e7]
        if index == 0 && gap { value["breakBefore"] = true }
        result.append(value)
      }
      previousEnd = segment.lastAtMs
      previousRecording = recording
    }
  }
  return result
}
