import CryptoKit
import Foundation
import GRDB

/// Raw keyset page, ordered by timestamp and row id so equal timestamps cannot lose fixes.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `getRideExportTrackPage`
internal func rideExportTrackPage(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?,
  afterMs: Int64, afterId: Int64) throws -> [Row] {
  try Row.fetchAll(db, sql: """
    SELECT * FROM ride_track_points
    WHERE fix_at_ms >= ? AND fix_at_ms <= ? AND board_id IS ?
      AND (fix_at_ms > ? OR (fix_at_ms = ? AND id > ?))
    ORDER BY fix_at_ms, id LIMIT ?
    """, arguments: [fromMs, toMs, boardId, afterMs, afterMs, afterId, RideExport.batchSize])
}

/// Caller holds one database snapshot across every page; only the file crosses the bridge.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideExport.kt
/// @parity /modules/vescape-core/src/index.ts `RideExportOptions`
/// @parity /modules/vescape-core/src/index.ts `RideExportFile`
internal enum RideExport {
  static let batchSize = 1000

  enum Format {
    case gpx, csv, floaty
    var fileExtension: String {
      switch self { case .gpx: return "gpx"; case .csv: return "csv"; case .floaty: return "json" }
    }
    var mimeType: String {
      switch self { case .gpx: return "application/gpx+xml"; case .csv: return "text/csv"; case .floaty: return "application/json" }
    }
    var uti: String {
      switch self { case .gpx: return "com.topografix.gpx"; case .csv: return "public.comma-separated-values-text"; case .floaty: return "public.json" }
    }
  }

  static func gpx(_ db: Database, directory: URL, options: [String: Any]) throws -> [String: Any] {
    try file(directory: directory, options: options, format: .gpx) { from, to, boardId, write in
      try writeGpx(db, fromMs: from, toMs: to, boardId: boardId,
        name: options["name"] as? String ?? "Vescape ride", write: write)
    }
  }

  static func csv(_ db: Database, directory: URL, options: [String: Any]) throws -> [String: Any] {
    try file(directory: directory, options: options, format: .csv) { from, to, boardId, write in
      try writeCsv(db, fromMs: from, toMs: to, boardId: boardId, write: write)
    }
  }

  /// `batteryPercent` is the Board's 0–100 estimate for pack volts and battery amps, nil when unknown.
  static func floaty(_ db: Database, directory: URL, options: [String: Any],
    batteryPercent: (_ voltageV: Double, _ batteryCurrentA: Double) -> Double?) throws -> [String: Any] {
    try file(directory: directory, options: options, format: .floaty) { from, to, boardId, write in
      try writeFloaty(db, fromMs: from, toMs: to, boardId: boardId, name: options["name"] as? String,
        batteryPercent: batteryPercent, write: write)
    }
  }

  private static func file(directory: URL, options: [String: Any], format: Format,
    body: (_ fromMs: Int64, _ toMs: Int64, _ boardId: String?, _ write: (String) throws -> Void) throws -> Void) throws -> [String: Any] {
    guard let from = options["fromMs"] as? NSNumber, let to = options["toMs"] as? NSNumber,
      from.int64Value <= to.int64Value else { throw NSError(domain: "RideExport", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid export range"]) }
    return try write(directory: directory, prefix: "vescape-ride", format: format) { write in
      try withoutActuallyEscaping(write) { try body(from.int64Value, to.int64Value, options["boardId"] as? String, $0) }
    }
  }

  /// Live telemetry, every frame at full rate, in the ride CSV's columns. Live frames carry no GPS
  /// fix, so the location columns stay empty.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideExport.kt `liveCsv`
  static func liveCsv(_ rows: [[String: Any?]], directory: URL) throws -> [String: Any] {
    guard !rows.isEmpty else {
      throw NSError(domain: "RideExport", code: 3, userInfo: [NSLocalizedDescriptionKey: "No live telemetry to export"])
    }
    return try write(directory: directory, prefix: "vescape-live", format: .csv) { write in
      try writeLiveCsv(rows, write: write)
    }
  }

  private static func write(directory: URL, prefix: String, format: Format,
    body: (_ write: (String) throws -> Void) throws -> Void) throws -> [String: Any] {
    let file = directory.appendingPathComponent("\(prefix)-\(UUID().uuidString).\(format.fileExtension)")
    do {
      guard FileManager.default.createFile(atPath: file.path, contents: nil) else {
        throw NSError(domain: "RideExport", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not create export file"])
      }
      let handle = try FileHandle(forWritingTo: file)
      do {
        var buffer = Data()
        try body {
          buffer.append(contentsOf: $0.utf8)
          if buffer.count >= 64_000 { try handle.write(contentsOf: buffer); buffer.removeAll(keepingCapacity: true) }
        }
        try handle.write(contentsOf: buffer)
        try handle.close()
      } catch {
        // intentional-suppression: preserve the write failure; closing again is best-effort cleanup.
        try? handle.close()
        throw error
      }
      return ["uri": file.absoluteString, "mimeType": format.mimeType, "uti": format.uti]
    } catch {
      // intentional-suppression: preserve the export failure; OS temporary storage can reclaim leftovers.
      try? FileManager.default.removeItem(at: file)
      throw error
    }
  }

  static func writeGpx(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?,
    name: String, write: (String) throws -> Void) throws {
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
        afterMs: afterMs, afterId: afterId)
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

  static func writeCsv(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?,
    write: (String) throws -> Void) throws {
    try write(csvLine(csvHeaders))
    let gps = TrackCursor(db, fromMs: fromMs, toMs: toMs, boardId: boardId)
    var currentGps = try gps.next(), nextGps = try gps.next()
    try forEachFrame(db, fromMs: fromMs, toMs: toMs, boardId: boardId) { timestamp, values in
      while let next = nextGps, next.fixAtMs <= timestamp { currentGps = next; nextGps = try gps.next() }
      func scaled(_ i: Int, _ divisor: Double) -> Double? { values[i].map { Double($0) / divisor } }
      let packedState = values[10]
      let p = currentGps
      let cells: [Any?] = [timestamp, scaled(0, 100), scaled(4, 1000), scaled(1, 1000),
        scaled(3, 1000), scaled(2, 1000), scaled(16, 10), scaled(15, 10), scaled(14, 100),
        scaled(6, 100), scaled(7, 100), scaled(5, 100), packedState.map { $0 & 15 },
        footpadSwitch(values[11].map { Int($0) }, scaled(12, 1000), scaled(13, 1000)),
        packedState.map { ($0 >> 4) & 15 }, scaled(12, 1000), scaled(13, 1000), p?.altitudeCm.map { Double($0) / 100 },
        p.map { Double($0.latitudeE7) / 10_000_000 }, p.map { Double($0.longitudeE7) / 10_000_000 },
        p?.accuracyCm.map { Double($0) / 100 }, p?.gpsSpeedCentiMps.map { Double($0) / 100 },
        p?.fixAtMs, values[9], scaled(8, 1000), values[11]]
      try write(csvLine(cells))
    }
  }

  /// Integration stops across gaps longer than this, so a paused recording adds no energy.
  static let floatyGapMs: Int64 = 5000

  /// Floaty 3 session JSON (`schemaVersion` 2) in Floaty's units: every stored frame as a log, every
  /// precise fix as a location, timestamps unique per array, no nulls in either. Session totals come
  /// after the arrays, so one streaming pass suffices.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideExport.kt `writeFloaty`
  static func writeFloaty(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?, name: String?,
    batteryPercent: (_ voltageV: Double, _ batteryCurrentA: Double) -> Double?,
    write: (String) throws -> Void) throws {
    let id = floatyId(fromMs: fromMs, toMs: toMs, boardId: boardId)
    let sessionId = ",\"sessionId\":\"\(id)\"}"
    try write("{\"schemaVersion\":2,\"id\":\"\(id)\",\"name\":\(name.map(jsonString) ?? "null"),\"boardId\":\(jsonString(boardId ?? "")),\"startTime\":\(fromMs),\"endTime\":\(toMs),\"stopReason\":null,\"userId\":null,\"groupRideId\":null,\"logs\":[")
    var lastLog: Int64?, lastOdometer: Int64?, tripCm: Int64 = 0
    var previousVoltage: Int64?, previousCurrent: Int64?
    // Consumed counters like VESC's: discharge only, regen never subtracts. mA·ms and µW·ms stay
    // integral, so both platforms round the same totals.
    var milliAmpMs: Int64 = 0, microWattMs: Int64 = 0
    try forEachFrame(db, fromMs: fromMs, toMs: toMs, boardId: boardId) { timestamp, v in
      guard timestamp != lastLog else { return }
      if let last = lastLog, let mv = previousVoltage, let ma = previousCurrent, ma > 0, timestamp - last <= floatyGapMs {
        milliAmpMs += ma * (timestamp - last); microWattMs += mv * ma * (timestamp - last)
      }
      let first = lastLog == nil
      lastLog = timestamp; previousVoltage = v[1]; previousCurrent = v[3]
      // Forward deltas only: an odometer reset rebases instead of going negative.
      if let odometer = v[14] {
        if let previous = lastOdometer, odometer > previous { tripCm += odometer - previous }
        lastOdometer = odometer
      }
      let percent = v[1].flatMap { batteryPercent(Double($0) / 1000, Double(v[3] ?? 0) / 1000) }
        .map { Int64((min(max($0, 0), 100) * 100 + 0.5).rounded(.down)) } ?? 0
      func d(_ i: Int, _ scale: Int) -> String { decimal(v[i] ?? 0, scale) }
      // Floaty stores speed and duty unsigned; reverse riding stays positive like GPS speed.
      func unsigned(_ i: Int, _ scale: Int) -> String { decimal(abs(v[i] ?? 0), scale) }
      let packedState = v[10] ?? 0
      let footpad = footpadSwitch(v[11].map { Int($0) }, v[12].map { Double($0) / 1000 }, v[13].map { Double($0) / 1000 }) ?? 0
      try write((first ? "" : ",") + "{\"timestamp\":\(timestamp),\"speed\":\(unsigned(0, 2)),\"dutyCycle\":\(unsigned(4, 3)),\"batteryVolts\":\(d(1, 3)),\"batteryPercent\":\(decimal(percent, 4)),\"batteryCurrent\":\(d(3, 3)),\"motorCurrent\":\(d(2, 3)),\"motorTemp\":\(d(16, 1)),\"controllerTemp\":\(d(15, 1)),\"tripDistance\":\(decimal(tripCm, 5)),\"lifeDistance\":\(d(14, 5)),\"remainingDistance\":0,\"rollAngle\":\(d(6, 2)),\"pitchAngle\":\(d(7, 2)),\"truePitchAngle\":\(d(5, 2)),\"inputTilt\":0,\"throttle\":0,\"ampHours\":\(decimal(roundDiv(milliAmpMs, 3_600), 6)),\"wattHours\":\(decimal(roundDiv(microWattMs, 3_600_000), 6)),\"state\":\(packedState & 15),\"switchState\":\(footpad),\"setpointAdjustmentType\":\((packedState >> 4) & 15),\"faultCode\":0,\"adc1\":\(d(12, 3)),\"adc2\":\(d(13, 3)),\"batteryUtilization\":0,\"phaseUtilization\":0" + sessionId)
    }
    try write("],\"locations\":[")
    let gps = TrackCursor(db, fromMs: fromMs, toMs: toMs, boardId: boardId)
    var lastFix: Int64?, polyline = "", lastLat: Int64 = 0, lastLon: Int64 = 0
    var minLat = Int64.max, maxLat = Int64.min, minLon = Int64.max, maxLon = Int64.min
    while let p = try gps.next() {
      guard p.fixAtMs != lastFix else { continue }
      try write((lastFix == nil ? "" : ",") + "{\"timestamp\":\(p.fixAtMs),\"speed\":\(decimal(Int64(p.gpsSpeedCentiMps ?? 0) * 36, 3)),\"altitude\":\(decimal(Int64(p.altitudeCm ?? 0), 2)),\"latitude\":\(decimal(p.latitudeE7, 7)),\"longitude\":\(decimal(p.longitudeE7, 7)),\"accuracy\":\(decimal(Int64(p.accuracyCm ?? 0), 2))" + sessionId)
      lastFix = p.fixAtMs
      let lat = roundDiv(p.latitudeE7, 100), lon = roundDiv(p.longitudeE7, 100)
      appendPolyline(lat - lastLat, to: &polyline); appendPolyline(lon - lastLon, to: &polyline)
      lastLat = lat; lastLon = lon
      minLat = min(minLat, p.latitudeE7); maxLat = max(maxLat, p.latitudeE7)
      minLon = min(minLon, p.longitudeE7); maxLon = max(maxLon, p.longitudeE7)
    }
    func bound(_ e7: Int64) -> String { lastFix == nil ? "null" : decimal(e7, 7) }
    try write("],\"distance\":\(decimal(tripCm, 5)),\"polyline\":\(lastFix == nil ? "null" : jsonString(polyline)),\"minLatitude\":\(bound(minLat)),\"maxLatitude\":\(bound(maxLat)),\"minLongitude\":\(bound(minLon)),\"maxLongitude\":\(bound(maxLon))}\n")
  }

  /// Name-based UUID v3 of the exported range, so re-importing the same ride replaces nothing.
  static func floatyId(fromMs: Int64, toMs: Int64, boardId: String?) -> String {
    var b = Array(Insecure.MD5.hash(data: Data("vescape-ride:\(boardId ?? ""):\(fromMs):\(toMs)".utf8)))
    b[6] = b[6] & 0x0f | 0x30; b[8] = b[8] & 0x3f | 0x80
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
      .uuidString.lowercased()
  }

  /// Google encoded polyline, one signed 1e-5 degree delta.
  private static func appendPolyline(_ delta: Int64, to out: inout String) {
    var v = UInt64(bitPattern: delta < 0 ? ~(delta << 1) : delta << 1)
    while v >= 0x20 { out.unicodeScalars.append(UnicodeScalar(UInt8((0x20 | (v & 0x1f)) + 63))); v >>= 5 }
    out.unicodeScalars.append(UnicodeScalar(UInt8(v + 63)))
  }

  /// Exact decimal for an integer stored at `scale` fractional digits, trailing zeros trimmed.
  private static func decimal(_ value: Int64, _ scale: Int) -> String {
    var divisor: UInt64 = 1
    for _ in 0..<scale { divisor *= 10 }
    let magnitude = value.magnitude
    var fraction = String(magnitude % divisor)
    fraction = String(repeating: "0", count: scale - fraction.count) + fraction
    while fraction.last == "0" { fraction.removeLast() }
    return (value < 0 ? "-" : "") + String(magnitude / divisor) + (fraction.isEmpty ? "" : "." + fraction)
  }

  /// Half-up integer division for positive `divisor`.
  private static func roundDiv(_ value: Int64, _ divisor: Int64) -> Int64 {
    let n = value + divisor / 2
    return n >= 0 ? n / divisor : -((-n + divisor - 1) / divisor)
  }

  private static func jsonString(_ value: String) -> String {
    var out = "\""
    for c in value.unicodeScalars {
      switch c {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case _ where c.value < 0x20: out += String(format: "\\u%04x", c.value)
      default: out.unicodeScalars.append(c)
      }
    }
    return out + "\""
  }

  /// Every stored frame in range with its reconstructed values, replaying the mask chain from the
  /// preceding keyframe even for Android archives imported on iOS. Values are in storage mask bit order.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `getRideExportKeyframe`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `getRideExportTelemetryPage`
  private static func forEachFrame(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?,
    _ body: (_ timestamp: Int64, _ values: [Int64?]) throws -> Void) throws {
    let keyframe = try Row.fetchOne(db, sql: """
      SELECT * FROM telemetry_frames WHERE captured_at_ms < ? AND board_id IS ?
        AND (flags & 1) != 0
      ORDER BY captured_at_ms DESC, id DESC LIMIT 1
      """, arguments: [fromMs, boardId])
    let start: Int64 = keyframe?["captured_at_ms"] ?? fromMs
    var afterMs = start, afterId = Int64.min
    // Storage mask bit order; NULL with a set bit explicitly clears an optional reading.
    let columns = ["speed_centi_kmh", "battery_voltage_mv", "motor_current_ma", "battery_current_ma",
      "duty_permille", "pitch_centi_deg", "roll_centi_deg", "balance_pitch_centi_deg", "balance_current_ma",
      "erpm", "state", "switch_state", "adc1_milli", "adc2_milli", "odometer_cm", "temp_mosfet_deci_c", "temp_motor_deci_c"]
    var values = [Int64?](repeating: nil, count: columns.count)
    while true {
      let rows = try Row.fetchAll(db, sql: """
        SELECT * FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?
          AND board_id IS ?
          AND (captured_at_ms > ? OR (captured_at_ms = ? AND id > ?))
        ORDER BY captured_at_ms, id LIMIT ?
        """, arguments: [start, toMs, boardId, afterMs, afterMs, afterId, batchSize])
      guard let last = rows.last else { break }
      for row in rows {
        let timestamp: Int64 = row["captured_at_ms"], flags: Int = row["flags"], mask: Int = row["changed_mask_1"]
        if flags & 1 != 0 { values = [Int64?](repeating: nil, count: columns.count) }
        for i in columns.indices where flags & 1 != 0 || mask & (1 << i) != 0 { values[i] = row[columns[i]] }
        if timestamp >= fromMs { try body(timestamp, values) }
      }
      afterMs = last["captured_at_ms"]; afterId = last["id"]
    }
  }

  private static func writeLiveCsv(_ rows: [[String: Any?]], write: (String) throws -> Void) throws {
    var batch = csvLine(csvHeaders)
    for row in rows {
      func num(_ key: String) -> Double? { (row[key] ?? nil) as? Double }
      func int(_ key: String) -> Int? { (row[key] ?? nil) as? Int }
      let packedState = int("state"), rawSwitch = int("switchState")
      batch += csvLine([row["lastPacketAt"] ?? nil, num("speed"), num("dutyCycle"), num("batteryVoltage"),
        num("batteryCurrent"), num("motorCurrent"), num("tempMotor"), num("tempMosfet"), num("odometer"),
        num("roll"), num("balancePitch"), num("pitch"), packedState.map { $0 & 15 },
        footpadSwitch(rawSwitch, num("adc1"), num("adc2")), packedState.map { ($0 >> 4) & 15 }, num("adc1"),
        num("adc2"), nil, nil, nil, nil, nil, nil, row["erpm"] ?? nil, num("balanceCurrent"), rawSwitch])
      if batch.utf8.count > 64_000 { try write(batch); batch = "" }
    }
    try write(batch)
  }

  /// Float Control's switch column from Refloat's raw state: one pad down reads as the side that is.
  private static func footpadSwitch(_ raw: Int?, _ adc1: Double?, _ adc2: Double?) -> Int? {
    switch raw.map({ $0 & 15 }) {
    case 0: return 0
    case 2: return 3
    case 1:
      guard let adc1, let adc2 else { return nil }
      return adc1 > adc2 ? 1 : 2
    default: return nil
    }
  }

  private final class TrackCursor {
    let db: Database, fromMs: Int64, toMs: Int64, boardId: String?
    var rows: [Row] = [], index = 0
    var afterMs: Int64, afterId = Int64.min
    var finished = false
    init(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?) {
      self.db = db; self.fromMs = fromMs; self.toMs = toMs; self.boardId = boardId
      afterMs = fromMs
    }
    func next() throws -> RideTrackPoint? {
      while !finished {
        if index == rows.count {
          rows = try rideExportTrackPage(db, fromMs: fromMs, toMs: toMs, boardId: boardId,
            afterMs: afterMs, afterId: afterId)
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
