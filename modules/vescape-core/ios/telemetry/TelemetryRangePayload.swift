import ExpoModulesCore
import Foundation
import GRDB

/// Bottom history chart overview; full samples remain available for map and chart screen.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `HISTORY_CHART_OVERVIEW_SAMPLES`
private let HISTORY_CHART_OVERVIEW_SAMPLES = 600

// The bridge edge of Ride History reads. `NativeArrayBuffer` is an Expo type, so the columnar range
// payload — and the one query that returns it — live here instead of in `TelemetryRepository.swift`.
// That keeps the repository, the DAO and the migrator free of the Expo runtime, which is what lets
// the SPM test target (`bun run test:ios`) compile and exercise them.

extension TelemetryRepository {
  func getRange(_ options: [String: Any]) -> [String: Any?] {
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let toMs = telemetryLong(options["toMs"]) ?? telemetryNowMs()
    let limit = min(MAX_SAMPLE_LIMIT, max(1, telemetryInt(options["limit"]) ?? DEFAULT_SAMPLE_LIMIT))
    let boardId = options["boardId"] as? String
    guard let pool else { return emptyRangePayload() }
    // Markers and Metric Exclusion Ranges still key on the BLE identifier (ADR 0028), so a
    // Board-scoped range read translates before it can filter them.

    // Battery configs, board names and the smoothing window are read up front (each opens its own
    // DB read) so the estimate stays a pure computation inside the range read below.
    let configs = batteryConfigByBoard()
    let boardNames = Self.boardNamesById()
    let windowMs = socWindowMs()
    return (try? pool.read { db -> [String: Any?] in
      let sampleRows = try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM telemetry_frames
          WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND (? IS NULL OR board_id = ?)
          ORDER BY captured_at_ms ASC
          LIMIT ?
          """,
        arguments: [fromMs, toMs, boardId, boardId, limit]
      )
      let markers = try Row.fetchAll(
        db,
        sql: "SELECT * FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? AND (? IS NULL OR board_id = ?) ORDER BY occurred_at_ms ASC",
        arguments: [fromMs, toMs, boardId, boardId]
      )
      let exclusions = try Row.fetchAll(
        db,
        sql: "SELECT * FROM metric_exclusion_ranges WHERE end_ms >= ? AND start_ms <= ? AND (? IS NULL OR board_id = ?) ORDER BY start_ms ASC",
        arguments: [fromMs, toMs, boardId, boardId]
      ).map(exclusionMap)
      let percents = self.batteryPercents(sampleRows, configs: configs, windowMs: windowMs)
      let overviewIndices = evenlySpacedIndices(sampleRows.count, limit: HISTORY_CHART_OVERVIEW_SAMPLES)
      let overviewRows = overviewIndices.map { sampleRows[$0] }
      let overviewPercents = overviewIndices.map { percents[$0] }
      return mergeTelemetryPayload(
        sampleColumns(sampleRows, batteryPercents: percents, boardNames: boardNames),
        [
          "chartColumns": sampleColumns(
            overviewRows,
            batteryPercents: overviewPercents,
            boardNames: boardNames
          )["boardColumns"],
          "chartCount": overviewRows.count,
          "gpsSamples": gpsMaps(sampleRows, boardNames: boardNames),
          "markers": markers.map(markerMap),
          "exclusions": exclusions,
        ]
      )
    }) ?? emptyRangePayload()
  }
}

private func evenlySpacedIndices(_ count: Int, limit: Int) -> [Int] {
  guard count > limit else { return Array(0..<count) }
  let denominator = limit - 1
  return (0..<limit).map { index in
    (index * (count - 1) + denominator / 2) / denominator
  }
}

/// Packs Telemetry Samples into the Float64 lane buffer the JS history decoder reads. This is the
/// bridge boundary, not storage: `NativeArrayBuffer` is an Expo type, so it lives with the repository
/// that answers JS calls rather than in the DAO.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `smoothedSampleColumns`
internal func sampleColumns(
  _ rows: [Row],
  batteryPercents: [Double?],
  boardNames: [String: String]
) -> [String: Any?] {
  var data = Data(capacity: rows.count * SAMPLE_COLUMN_COUNT * MemoryLayout<Double>.size)
  var boardIds: [String?] = []
  var names: [String] = []
  var boardIndex: [String: Int] = [:]
  for (i, row) in rows.enumerated() {
    let id: Int64 = row["id"]
    let rawBoardId = row["board_id"] as String?
    let key = rawBoardId ?? ""
    let index = boardIndex[key] ?? {
      boardIds.append(rawBoardId)
      names.append(rawBoardId.flatMap { boardNames[$0] } ?? UNKNOWN_TELEMETRY_BOARD_NAME)
      let newIndex = boardIds.count - 1
      boardIndex[key] = newIndex
      return newIndex
    }()
    appendDouble(&data, Double(id))
    appendDouble(&data, Double(row["captured_at_ms"] as Int64))
    appendDouble(&data, Double(index))
    appendDouble(&data, Double(row["speed_centi_kmh"] as Int? ?? 0) / 100.0)
    appendDouble(&data, Double(row["battery_voltage_mv"] as Int? ?? 0) / 1000.0)
    appendNullableDouble(&data, batteryPercents[i])
    appendDouble(&data, Double(row["motor_current_ma"] as Int? ?? 0) / 1000.0)
    appendDouble(&data, Double(row["battery_current_ma"] as Int? ?? 0) / 1000.0)
    appendDouble(&data, Double(row["duty_permille"] as Int? ?? 0) / 1000.0)
    appendDouble(&data, Double(row["pitch_centi_deg"] as Int? ?? 0) / 100.0)
    appendDouble(&data, Double(row["roll_centi_deg"] as Int? ?? 0) / 100.0)
    appendDouble(&data, Double(row["balance_pitch_centi_deg"] as Int? ?? 0) / 100.0)
    appendDouble(&data, Double(row["balance_current_ma"] as Int? ?? 0) / 1000.0)
    appendDouble(&data, Double(row["erpm"] as Int? ?? 0))
    appendDouble(&data, Double(row["state"] as Int? ?? 0))
    appendDouble(&data, Double(row["switch_state"] as Int? ?? 0))
    appendDouble(&data, Double(row["adc1_milli"] as Int? ?? 0) / 1000.0)
    appendDouble(&data, Double(row["adc2_milli"] as Int? ?? 0) / 1000.0)
    appendNullableDouble(&data, (row["odometer_cm"] as Int64?).map { Double($0) / 100.0 })
    appendNullableDouble(&data, (row["temp_mosfet_deci_c"] as Int?).map { Double($0) / 10.0 })
    appendNullableDouble(&data, (row["temp_motor_deci_c"] as Int?).map { Double($0) / 10.0 })
    appendNullableDouble(&data, (row["latitude_e7"] as Int64?).map { Double($0) / 10_000_000.0 })
    appendNullableDouble(&data, (row["longitude_e7"] as Int64?).map { Double($0) / 10_000_000.0 })
  }
  return [
    "boardColumns": (try? NativeArrayBuffer.copy(data: data)) ?? NativeArrayBuffer.allocate(size: 0),
    "boardCount": rows.count,
    "boardIds": boardIds,
    "boardNames": names,
  ]
}

internal func emptyRangePayload() -> [String: Any?] {
  [
    "boardColumns": NativeArrayBuffer.allocate(size: 0),
    "boardCount": 0,
    "boardIds": [] as [String?],
    "boardNames": [] as [String],
    "chartColumns": NativeArrayBuffer.allocate(size: 0),
    "chartCount": 0,
    "gpsSamples": [] as [[String: Any?]],
    "markers": [] as [[String: Any?]],
    "exclusions": [] as [[String: Any?]],
  ]
}
