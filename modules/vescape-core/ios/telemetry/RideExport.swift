import Foundation
import GRDB

/// Raw keyset page, ordered by timestamp and row id so equal timestamps cannot lose fixes.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `getRideExportTrackPage`
internal func rideExportTrackPage(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?,
  recordingId: String?, afterMs: Int64, afterId: Int64) throws -> [Row] {
  try Row.fetchAll(db, sql: """
    SELECT * FROM ride_track_points
    WHERE fix_at_ms >= ? AND fix_at_ms <= ? AND board_id IS ?
      AND (? IS NULL OR recording_id = ?)
      AND (fix_at_ms > ? OR (fix_at_ms = ? AND id > ?))
    ORDER BY fix_at_ms, id LIMIT ?
    """, arguments: [fromMs, toMs, boardId, recordingId, recordingId, afterMs, afterMs, afterId, RideExport.batchSize])
}

/// Caller holds one database snapshot across every page; only the file crosses the bridge.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideExport.kt
/// @parity /modules/vescape-core/src/index.ts `RideExportOptions`
/// @parity /modules/vescape-core/src/index.ts `RideExportFile`
internal enum RideExport {
  static let batchSize = 1000

  static func gpx(_ db: Database, directory: URL, options: [String: Any]) throws -> [String: Any] {
    try file(db, directory: directory, options: options, csv: false)
  }

  static func csv(_ db: Database, directory: URL, options: [String: Any]) throws -> [String: Any] {
    try file(db, directory: directory, options: options, csv: true)
  }

  private static func file(_ db: Database, directory: URL, options: [String: Any], csv: Bool) throws -> [String: Any] {
    guard let from = options["fromMs"] as? NSNumber, let to = options["toMs"] as? NSNumber,
      from.int64Value <= to.int64Value else { throw NSError(domain: "RideExport", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid export range"]) }
    let file = directory.appendingPathComponent("vescape-ride-\(UUID().uuidString).\(csv ? "csv" : "gpx")")
    do {
      guard FileManager.default.createFile(atPath: file.path, contents: nil) else {
        throw NSError(domain: "RideExport", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not create export file"])
      }
      let handle = try FileHandle(forWritingTo: file)
      do {
        if csv {
          try writeCsv(db, fromMs: from.int64Value, toMs: to.int64Value,
            boardId: options["boardId"] as? String, recordingId: options["recordingId"] as? String) {
              try handle.write(contentsOf: Data($0.utf8))
            }
        } else {
          try writeGpx(db, fromMs: from.int64Value, toMs: to.int64Value,
            boardId: options["boardId"] as? String, recordingId: options["recordingId"] as? String,
            name: options["name"] as? String ?? "Vescape ride") { try handle.write(contentsOf: Data($0.utf8)) }
        }
        try handle.close()
      } catch {
        // intentional-suppression: preserve the write failure; closing again is best-effort cleanup.
        try? handle.close()
        throw error
      }
      return ["uri": file.absoluteString, "mimeType": csv ? "text/csv" : "application/gpx+xml", "uti": csv ? "public.comma-separated-values-text" : "com.topografix.gpx"]
    } catch {
      // intentional-suppression: preserve the export failure; OS temporary storage can reclaim leftovers.
      try? FileManager.default.removeItem(at: file)
      throw error
    }
  }

  static func writeGpx(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?,
    recordingId: String?, name: String, write: (String) throws -> Void) throws {
    let time = DateFormatter()
    time.locale = Locale(identifier: "en_US_POSIX")
    time.calendar = Calendar(identifier: .gregorian)
    time.timeZone = TimeZone(secondsFromGMT: 0)
    time.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
    try write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
    try write("<gpx version=\"1.1\" creator=\"Vescape\" xmlns=\"http://www.topografix.com/GPX/1/1\" xmlns:gpxtpx=\"http://www.garmin.com/xmlschemas/TrackPointExtension/v2\"><trk><name>\(xml(name))</name><trkseg>\n")
    var afterMs = fromMs, afterId = Int64.min
    while true {
      let rows = try rideExportTrackPage(db, fromMs: fromMs, toMs: toMs, boardId: boardId,
        recordingId: recordingId, afterMs: afterMs, afterId: afterId)
      guard let last = rows.last else { break }
      var batch = ""
      for row in rows {
        let p = rideTrackPoint(row)
        guard rideTrackFixIsPrecise(p) else { continue }
        batch += "<trkpt lat=\"\(coordinate(p.latitudeE7))\" lon=\"\(coordinate(p.longitudeE7))\">"
        if let altitude = p.altitudeCm { batch += "<ele>\(Double(altitude) / 100.0)</ele>" }
        batch += "<time>\(time.string(from: Date(timeIntervalSince1970: Double(p.fixAtMs) / 1000.0)))</time>"
        if let speed = p.gpsSpeedCentiMps {
          batch += "<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>\(Double(speed) / 100.0)</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>"
        }
        batch += "</trkpt>\n"
      }
      try write(batch)
      afterMs = last["fix_at_ms"]; afterId = last["id"]
    }
    try write("</trkseg></trk></gpx>\n")
  }

  static let csvHeaders = ["timestamp", "speed", "dutyCycle", "batteryVolts", "batteryCurrent", "motorCurrent",
    "motorTemp", "controllerTemp", "lifeDistance", "rollAngle", "pitchAngle", "truePitchAngle", "state",
    "switchState", "setpointAdjustmentType", "adc1", "adc2", "altitude", "latitude", "longitude", "accuracy",
    "gpsSpeed", "gpsTimestamp", "erpm", "balanceCurrent", "rawSwitchState"]

  static func csvLine(_ cells: [Any?]) -> String {
    cells.map { value in
      let text = value.map { String(describing: $0) } ?? ""
      return text.unicodeScalars.contains(where: { $0 == "," || $0 == "\"" || $0 == "\r" || $0 == "\n" })
        ? "\"" + text.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : text
    }.joined(separator: ",") + "\r\n"
  }

  /// Reconstruct the stored mask chain even for Android archives imported on iOS.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `getRideExportKeyframe`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `getRideExportTelemetryPage`
  static func writeCsv(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?,
    recordingId: String?, write: (String) throws -> Void) throws {
    try write(csvLine(csvHeaders))
    let gps = TrackCursor(db, fromMs: fromMs, toMs: toMs, boardId: boardId, recordingId: recordingId)
    var currentGps = try gps.next(), nextGps = try gps.next()
    let keyframe = try Row.fetchOne(db, sql: """
      SELECT * FROM telemetry_frames WHERE captured_at_ms < ? AND board_id IS ?
        AND (? IS NULL OR recording_id = ?) AND (flags & 1) != 0
      ORDER BY captured_at_ms DESC, id DESC LIMIT 1
      """, arguments: [fromMs, boardId, recordingId, recordingId])
    let start: Int64 = keyframe?["captured_at_ms"] ?? fromMs
    var afterMs = start, afterId = Int64.min
    // Storage mask bit order; NULL with a set bit explicitly clears an optional reading.
    let columns = ["speed_centi_kmh", "battery_voltage_mv", "motor_current_ma", "battery_current_ma",
      "duty_permille", "pitch_centi_deg", "roll_centi_deg", "balance_pitch_centi_deg", "balance_current_ma",
      "erpm", "state", "switch_state", "adc1_milli", "adc2_milli", "odometer_cm", "temp_mosfet_deci_c", "temp_motor_deci_c"]
    var values = [Int64?](repeating: nil, count: columns.count)
    var previousRecording: String?
    while true {
      let rows = try Row.fetchAll(db, sql: """
        SELECT * FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?
          AND board_id IS ? AND (? IS NULL OR recording_id = ?)
          AND (captured_at_ms > ? OR (captured_at_ms = ? AND id > ?))
        ORDER BY captured_at_ms, id LIMIT ?
        """, arguments: [start, toMs, boardId, recordingId, recordingId, afterMs, afterMs, afterId, batchSize])
      guard let last = rows.last else { break }
      var batch = ""
      for row in rows {
        let timestamp: Int64 = row["captured_at_ms"], flags: Int = row["flags"], mask: Int = row["changed_mask_1"]
        let recording: String? = row["recording_id"]
        if flags & 1 != 0 || recording != previousRecording { values = [Int64?](repeating: nil, count: columns.count) }
        previousRecording = recording
        for i in columns.indices where flags & 1 != 0 || mask & (1 << i) != 0 { values[i] = row[columns[i]] }
        if timestamp < fromMs { continue }
        while let next = nextGps, next.fixAtMs <= timestamp { currentGps = next; nextGps = try gps.next() }
        func scaled(_ i: Int, _ divisor: Double) -> Double? { values[i].map { Double($0) / divisor } }
        let packedState = values[10]
        let switchState: Int? = values[11].flatMap { packed in
          switch packed & 15 {
          case 0: return 0
          case 2: return 3
          case 1:
            guard let adc1 = values[12], let adc2 = values[13] else { return nil }
            return adc1 > adc2 ? 1 : 2
          default: return nil
          }
        }
        let p = currentGps
        let cells: [Any?] = [timestamp, scaled(0, 100), scaled(4, 1000), scaled(1, 1000),
          scaled(3, 1000), scaled(2, 1000), scaled(16, 10), scaled(15, 10), scaled(14, 100),
          scaled(6, 100), scaled(7, 100), scaled(5, 100), packedState.map { $0 & 15 }, switchState,
          packedState.map { ($0 >> 4) & 15 }, scaled(12, 1000), scaled(13, 1000), p?.altitudeCm.map { Double($0) / 100 },
          p.map { Double($0.latitudeE7) / 10_000_000 }, p.map { Double($0.longitudeE7) / 10_000_000 },
          p?.accuracyCm.map { Double($0) / 100 }, p?.gpsSpeedCentiMps.map { Double($0) / 100 },
          p?.fixAtMs, values[9], scaled(8, 1000), values[11]]
        batch += csvLine(cells)
      }
      try write(batch)
      afterMs = last["captured_at_ms"]; afterId = last["id"]
    }
  }

  private final class TrackCursor {
    let db: Database, fromMs: Int64, toMs: Int64, boardId: String?, recordingId: String?
    var rows: [Row] = [], index = 0
    var afterMs: Int64, afterId = Int64.min
    var finished = false
    init(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?, recordingId: String?) {
      self.db = db; self.fromMs = fromMs; self.toMs = toMs; self.boardId = boardId; self.recordingId = recordingId
      afterMs = fromMs
    }
    func next() throws -> RideTrackPoint? {
      while !finished {
        if index == rows.count {
          rows = try rideExportTrackPage(db, fromMs: fromMs, toMs: toMs, boardId: boardId,
            recordingId: recordingId, afterMs: afterMs, afterId: afterId)
          index = 0
          guard let last = rows.last else { finished = true; return nil }
          afterMs = last["fix_at_ms"]; afterId = last["id"]
        }
        let point = rideTrackPoint(rows[index]); index += 1
        if rideTrackFixIsPrecise(point) { return point }
      }
      return nil
    }
  }

  private static func coordinate(_ e7: Int64) -> String {
    let magnitude = abs(e7)
    let fraction = String(magnitude % 10_000_000)
    return "\(e7 < 0 ? "-" : "")\(magnitude / 10_000_000).\(String(repeating: "0", count: 7 - fraction.count))\(fraction)"
  }

  private static func xml(_ value: String) -> String {
    String(value.unicodeScalars.filter { c in
      let v = c.value
      return v == 9 || v == 10 || v == 13 || (0x20...0xD7FF).contains(v) || (0xE000...0xFFFD).contains(v) || (0x10000...0x10FFFF).contains(v)
    }).replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "'", with: "&apos;")
  }
}
