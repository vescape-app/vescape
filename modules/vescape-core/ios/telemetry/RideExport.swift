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
    guard let from = options["fromMs"] as? NSNumber, let to = options["toMs"] as? NSNumber,
      from.int64Value <= to.int64Value else { throw NSError(domain: "RideExport", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid export range"]) }
    let file = directory.appendingPathComponent("vescape-ride-\(UUID().uuidString).gpx")
    do {
      guard FileManager.default.createFile(atPath: file.path, contents: nil) else {
        throw NSError(domain: "RideExport", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not create export file"])
      }
      let handle = try FileHandle(forWritingTo: file)
      do {
        try writeGpx(db, fromMs: from.int64Value, toMs: to.int64Value,
          boardId: options["boardId"] as? String, recordingId: options["recordingId"] as? String,
          name: options["name"] as? String ?? "Vescape ride") { try handle.write(contentsOf: Data($0.utf8)) }
        try handle.close()
      } catch {
        // intentional-suppression: preserve the write failure; closing again is best-effort cleanup.
        try? handle.close()
        throw error
      }
      return ["uri": file.absoluteString, "mimeType": "application/gpx+xml", "uti": "com.topografix.gpx"]
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
        batch += "<trkpt lat=\"\(Double(p.latitudeE7) / 10_000_000.0)\" lon=\"\(Double(p.longitudeE7) / 10_000_000.0)\">"
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

  private static func xml(_ value: String) -> String {
    String(value.unicodeScalars.filter { c in
      let v = c.value
      return v == 9 || v == 10 || v == 13 || (0x20...0xD7FF).contains(v) || (0xE000...0xFFFD).contains(v) || (0x10000...0x10FFFF).contains(v)
    }).replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "'", with: "&apos;")
  }
}
