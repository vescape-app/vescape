import Foundation
import GRDB

private let rideBucketBatchSize = 100
private let maxRidePageSize = 50
private let rideBreakBoundaries: Set<String> = ["disconnected", "app_stop", "error"]

internal struct RideRoutePoint {
  let latitude: Double
  let longitude: Double
}

internal struct RideSessionAggregate {
  let deviceId: String
  var deviceName: String
  var boundaryBefore: String
  var firstBucketStartMs: Int64
  var startAtMs: Int64
  var endAtMs: Int64
  var blockIds: [String] = []
  var blockCount = 0
  var sampleCount = 0
  var gpsPointCount = 0
  var preciseGpsPointCount = 0
  var avgSpeedSampleCount = 0
  var avgSpeedWeightedSum = 0.0
  var movingStartAtMs: Int64?
  var movingEndAtMs: Int64?
  var distanceDeltaM = 0.0
  var distanceDeltaCount = 0
  var gpsDistanceM = 0.0
  var gpsDistanceCount = 0
  var topSpeedKmh = 0.0
  var maxTempMosfet: Double?
  var maxTempMotor: Double?
  var maxDuty = 0.0
  var batteryUsedWh = 0.0
  var batteryRegenWh = 0.0
  var firstLatitude: Double?
  var firstLongitude: Double?
  var latitudeSum = 0.0
  var longitudeSum = 0.0
  var coordinateCount = 0
  var minLatitude: Double?
  var maxLatitude: Double?
  var minLongitude: Double?
  var maxLongitude: Double?
  var faultCount = 0
  var routePoints: [RideRoutePoint] = []

  var distanceM: Double? {
    if distanceDeltaCount > 0 { return distanceDeltaM }
    if gpsDistanceCount > 0 { return gpsDistanceM }
    return nil
  }
}

/// Complete-ride paging over minute buckets. JS never observes a provisional, cut-off ride.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt
internal final class RideHistoryRepository {
  static let shared = RideHistoryRepository()
  private var pool: DatabasePool? { TelemetryDatabase.pool }
  private init() {}

  /// @parity /modules/vescape-core/src/index.ts `RideHistoryPage`
  func getPage(_ options: [String: Any]) -> [String: Any?] {
    let limit = min(maxRidePageSize, max(1, telemetryInt(options["limit"]) ?? 10))
    var beforeMs = telemetryLong(options["cursorBeforeMs"]) ?? Int64.max
    let gapMs = rideSplitGapMs()
    guard let pool else { return ["sessions": [], "hasMore": false, "nextCursorBeforeMs": nil] }
    return (try? pool.read { db in
      var buckets: [Row] = []
      var complete: [RideSessionAggregate] = []
      var hasOlderBuckets = true
      while hasOlderBuckets && complete.count < limit {
        let batch = try Row.fetchAll(
          db,
          sql: "SELECT * FROM telemetry_minute_buckets WHERE bucket_start_ms < ? AND sample_count > 0 ORDER BY bucket_start_ms DESC LIMIT ?",
          arguments: [beforeMs, rideBucketBatchSize + 1]
        )
        if batch.isEmpty { hasOlderBuckets = false; break }
        let pageBatch = Array(batch.prefix(rideBucketBatchSize))
        buckets.append(contentsOf: pageBatch)
        beforeMs = pageBatch.map { $0["bucket_start_ms"] as Int64 }.min() ?? beforeMs
        hasOlderBuckets = batch.count > rideBucketBatchSize
        let markerFrom = (buckets.map { $0["first_sample_at_ms"] as Int64 }.min() ?? 0) - gapMs
        let markerTo = (buckets.map { $0["last_sample_at_ms"] as Int64 }.max() ?? 0) + TELEMETRY_BUCKET_SIZE_MS
        let markers = try Row.fetchAll(
          db,
          sql: "SELECT * FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? ORDER BY occurred_at_ms ASC",
          arguments: [markerFrom, markerTo]
        )
        let grouped = groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs)
          .filter { $0.avgSpeedSampleCount > 0 }
        complete = completeRideSessions(grouped, hasOlderBuckets: hasOlderBuckets)
      }
      let sorted = complete.sorted { $0.startAtMs > $1.startAtMs }
      let cutoff = sorted.indices.contains(limit - 1) ? sorted[limit - 1].firstBucketStartMs : nil
      let page = cutoff.map { value in sorted.filter { $0.firstBucketStartMs >= value } } ?? sorted
      let hasMore = hasOlderBuckets || cutoff.map { value in sorted.contains { $0.firstBucketStartMs < value } } == true
      return [
        "sessions": page.map(rideSessionMap),
        "hasMore": hasMore,
        "nextCursorBeforeMs": hasMore ? page.last?.firstBucketStartMs : nil,
      ]
    }) ?? ["sessions": [], "hasMore": false, "nextCursorBeforeMs": nil]
  }

  private func rideSplitGapMs() -> Int64 {
    let minutes = telemetryInt(AppDataRepository.shared.getSettings()["rideSplitGapMinutes"] ?? nil)
    return Int64(minutes ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000
  }
}

/// Buckets arrive newest-first, so the only ride that may still grow backwards is the OLDEST one in
/// the window. Dropping the newest instead hides the ride being recorded right now.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt `completeRideSessions`
internal func completeRideSessions(
  _ grouped: [RideSessionAggregate],
  hasOlderBuckets: Bool
) -> [RideSessionAggregate] {
  hasOlderBuckets ? Array(grouped.dropFirst()) : grouped
}

/// Native Ride boundaries/aggregates shared by History pages and Profile stats.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt `groupRideSessions`
internal func groupRideSessions(buckets: [Row], markers: [Row], gapMs: Int64) -> [RideSessionAggregate] {
  var sessions: [RideSessionAggregate] = []
  var current: RideSessionAggregate?
  var previous: Row?
  for bucket in buckets.sorted(by: { ($0["first_sample_at_ms"] as Int64) < ($1["first_sample_at_ms"] as Int64) }) {
    if (bucket["sample_count"] as Int) <= 0 { continue }
    let boundary = rideBoundaryForBucket(bucket, markers: markers)
    let deviceId = bucket["device_id"] as String
    let split = current == nil || current?.deviceId != deviceId ||
      (previous.map { (bucket["first_sample_at_ms"] as Int64) - ($0["last_sample_at_ms"] as Int64) > gapMs } ?? false) ||
      rideBreakBoundaries.contains(boundary)
    if split {
      if let current { sessions.append(current) }
      current = RideSessionAggregate(
        deviceId: deviceId,
        deviceName: (bucket["device_name"] as String?) ?? "VESC Board",
        boundaryBefore: boundary,
        firstBucketStartMs: bucket["bucket_start_ms"] as Int64,
        startAtMs: bucket["first_sample_at_ms"] as Int64,
        endAtMs: bucket["last_sample_at_ms"] as Int64
      )
    }
    if var aggregate = current { mergeRideBucket(bucket, into: &aggregate); current = aggregate }
    previous = bucket
  }
  if let current { sessions.append(current) }
  return sessions
}

private func mergeRideBucket(_ bucket: Row, into session: inout RideSessionAggregate) {
  let bucketStart = bucket["bucket_start_ms"] as Int64
  session.firstBucketStartMs = min(session.firstBucketStartMs, bucketStart)
  session.startAtMs = min(session.startAtMs, bucket["first_sample_at_ms"] as Int64)
  session.endAtMs = max(session.endAtMs, bucket["last_sample_at_ms"] as Int64)
  session.blockIds.append("\(session.deviceId):\(bucketStart)")
  session.blockCount += 1
  session.sampleCount += bucket["sample_count"] as Int
  session.gpsPointCount += bucket["gps_point_count"] as Int
  session.preciseGpsPointCount += bucket["precise_gps_point_count"] as Int
  if let movingCount = bucket["moving_speed_sample_count"] as Int? {
    session.avgSpeedSampleCount += movingCount
    session.avgSpeedWeightedSum += Double((bucket["sum_moving_abs_speed_centi_kmh"] as Int64?) ?? 0) / 100.0
  } else {
    session.avgSpeedSampleCount += bucket["sample_count"] as Int
    session.avgSpeedWeightedSum += Double(bucket["sum_abs_speed_centi_kmh"] as Int64) / 100.0
  }
  if let value = bucket["first_moving_at_ms"] as Int64? { session.movingStartAtMs = session.movingStartAtMs.map { min($0, value) } ?? value }
  if let value = bucket["last_moving_at_ms"] as Int64? { session.movingEndAtMs = session.movingEndAtMs.map { max($0, value) } ?? value }
  if let distance = rideDistanceDeltaM(bucket) { session.distanceDeltaM += distance; session.distanceDeltaCount += 1 }
  let gpsDistance = Double(bucket["gps_distance_cm"] as Int64) / 100.0
  if gpsDistance > 0 { session.gpsDistanceM += gpsDistance; session.gpsDistanceCount += 1 }
  session.topSpeedKmh = max(session.topSpeedKmh, Double(bucket["max_abs_speed_centi_kmh"] as Int) / 100.0)
  if let value = bucket["max_temp_mosfet_deci_c"] as Int? { session.maxTempMosfet = max(session.maxTempMosfet ?? Double(value) / 10.0, Double(value) / 10.0) }
  if let value = bucket["max_temp_motor_deci_c"] as Int? { session.maxTempMotor = max(session.maxTempMotor ?? Double(value) / 10.0, Double(value) / 10.0) }
  session.maxDuty = max(session.maxDuty, Double(bucket["max_duty_abs_permille"] as Int) / 1000.0)
  session.batteryUsedWh += Double(bucket["battery_used_wh_milli"] as Int64) / 1000.0
  session.batteryRegenWh += Double(bucket["battery_regen_wh_milli"] as Int64) / 1000.0
  session.faultCount += bucket["fault_count"] as Int
  if let latE7 = bucket["first_latitude_e7"] as Int64?, let lonE7 = bucket["first_longitude_e7"] as Int64? {
    let latitude = Double(latE7) / 1e7, longitude = Double(lonE7) / 1e7
    if session.firstLatitude == nil { session.firstLatitude = latitude; session.firstLongitude = longitude }
    session.latitudeSum += latitude; session.longitudeSum += longitude; session.coordinateCount += 1
    session.minLatitude = min(session.minLatitude ?? latitude, latitude); session.maxLatitude = max(session.maxLatitude ?? latitude, latitude)
    session.minLongitude = min(session.minLongitude ?? longitude, longitude); session.maxLongitude = max(session.maxLongitude ?? longitude, longitude)
    session.routePoints.append(RideRoutePoint(latitude: latitude, longitude: longitude))
  }
}

private func rideBoundaryForBucket(_ bucket: Row, markers: [Row]) -> String {
  markers.last { marker in
    let occurred = marker["occurred_at_ms"] as Int64
    return occurred >= (bucket["first_sample_at_ms"] as Int64) - 5_000 &&
      occurred <= (bucket["first_sample_at_ms"] as Int64) + 1_000 &&
      ((marker["device_id"] as String?) ?? "") == (bucket["device_id"] as String)
  }.map { $0["type"] as String } ?? "none"
}

private func rideDistanceDeltaM(_ bucket: Row) -> Double? {
  guard let first = bucket["first_odometer_cm"] as Int64?, let last = bucket["last_odometer_cm"] as Int64? else { return nil }
  return Double(max(0, last - first)) / 100.0
}

/// @parity /modules/vescape-core/src/index.ts `RideHistorySession`
internal func rideSessionMap(_ session: RideSessionAggregate) -> [String: Any?] {
  let average = session.avgSpeedSampleCount > 0 ? session.avgSpeedWeightedSum / Double(session.avgSpeedSampleCount) : 0
  return [
    "id": "\(session.deviceId.isEmpty ? "unknown" : session.deviceId):\(session.startAtMs):\(session.endAtMs)",
    "deviceId": session.deviceId.isEmpty ? nil : session.deviceId, "deviceName": session.deviceName,
    "startAtMs": session.startAtMs, "endAtMs": session.endAtMs, "movingStartAtMs": session.movingStartAtMs,
    "movingEndAtMs": session.movingEndAtMs, "blockIds": session.blockIds, "blockCount": session.blockCount,
    "sampleCount": session.sampleCount, "gpsPointCount": session.gpsPointCount,
    "preciseGpsPointCount": session.preciseGpsPointCount, "distanceM": session.distanceM,
    "maxSpeedKmh": session.topSpeedKmh, "avgSpeedKmh": average, "maxTempMosfet": session.maxTempMosfet,
    "maxTempMotor": session.maxTempMotor, "maxDuty": session.maxDuty, "batteryUsedWh": session.batteryUsedWh,
    "batteryRegenWh": session.batteryRegenWh, "firstLatitude": session.firstLatitude,
    "firstLongitude": session.firstLongitude,
    "centerLatitude": session.coordinateCount > 0 ? session.latitudeSum / Double(session.coordinateCount) : nil,
    "centerLongitude": session.coordinateCount > 0 ? session.longitudeSum / Double(session.coordinateCount) : nil,
    "minLatitude": session.minLatitude, "maxLatitude": session.maxLatitude, "minLongitude": session.minLongitude,
    "maxLongitude": session.maxLongitude, "faultCount": session.faultCount, "boundaryBefore": session.boundaryBefore,
    "routePoints": session.routePoints.map { ["latitude": $0.latitude, "longitude": $0.longitude] },
  ]
}
