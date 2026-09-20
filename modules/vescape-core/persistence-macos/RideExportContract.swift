import Foundation
import GRDB

func runRideExportContract() throws {
  let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "shared/ride-export-contract.json"))) as! [String: Any]
  let count = fixture["count"] as! Int, prefix = fixture["imprecisePrefix"] as! Int
  let base = (fixture["baseMs"] as! NSNumber).int64Value
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ride-export-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let queue = try DatabaseQueue(path: directory.appendingPathComponent("test.db").path)
  try TelemetryDatabase.migrator.migrate(queue)
  func point(_ i: Int, board: String? = "board", recording: String? = "ride", accuracy: Int? = 2000) -> RideTrackPoint {
    RideTrackPoint(recordingId: recording, boardId: board, fixAtMs: base + Int64(i / 3),
      latitudeE7: Int64(521234567 + i), longitudeE7: -211234567, accuracyCm: accuracy,
      gpsSpeedCentiMps: i % 2 == 0 ? 456 : nil, bearingCentiDeg: nil, altitudeCm: i % 2 == 0 ? -1234 : nil)
  }
  try queue.write { db in
    for i in 0..<count { try insertRideTrackPoint(db, point(i, accuracy: i < prefix ? 2001 : 2000)) }
    for p in [point(1200, board: "other"), point(1200, recording: "other"),
      point(1200, recording: nil, accuracy: nil), point(1200, accuracy: nil), point(1200, board: nil)] {
      try insertRideTrackPoint(db, p)
    }
  }
  let from = base + 1, to = base + Int64((count - 4) / 3)
  func export(board: String? = "board", recording: String? = "ride", start: Int64? = nil, end: Int64? = nil) throws -> String {
    var options: [String: Any] = ["fromMs": start ?? from, "toMs": end ?? to, "name": fixture["name"]!]
    options["boardId"] = board; options["recordingId"] = recording
    let result = try queue.read { try RideExport.gpx($0, directory: directory, options: options) }
    let file = URL(string: result["uri"] as! String)!
    try require(file.deletingLastPathComponent().path == directory.path, "export safe filename")
    try require(result["mimeType"] as! String == "application/gpx+xml", "GPX MIME")
    let data = try Data(contentsOf: file)
    try require(XMLParser(data: data).parse(), "GPX parses as XML")
    return String(data: data, encoding: .utf8)!
  }
  func occurrences(_ xml: String, _ needle: String) -> Int { xml.components(separatedBy: needle).count - 1 }
  let xml = try export()
  let expected = (0..<count).filter { $0 >= prefix && (from...to).contains(base + Int64($0 / 3)) }
  try require(occurrences(xml, "<trkpt ") == expected.count, "export exceeds display cap after imprecise page")
  var remaining = xml[...]
  for i in expected {
    let coordinate = "lat=\"\(Double(521234567 + i) / 10_000_000.0)\""
    try require(remaining.range(of: coordinate) != nil, "point lost/reordered \(i)")
    let range = remaining.range(of: coordinate)!
    remaining = remaining[range.upperBound...]
  }
  try require(xml.contains("<name>\(fixture["escapedName"]!)</name>"), "XML name escaping and control removal")
  try require(xml.contains("<ele>-12.34</ele>") && xml.contains("<gpxtpx:speed>4.56</gpxtpx:speed>"), "stored altitude and speed units")
  try require(!export(start: base, end: base).contains("<trkpt "), "all imprecise empty GPX")
  let small = try export(start: base + 400, end: base + 400)
  try require(occurrences(small, "<trkpt ") == 3 && occurrences(small, "<ele>") == 2, "equal timestamps and optional fields")
  try require(small.contains("<time>2023-11-14T22:13:20.523Z</time>"), "UTC millisecond timestamp")
  try require(occurrences(export(recording: nil), "<trkpt ") == expected.count + 2, "legacy missing accuracy and Favorite recording range")
  try require(occurrences(export(board: nil), "<trkpt ") == 1, "null Board scope")
  try require(!export(board: "empty").contains("<trkpt "), "empty range exports valid XML")
  try queue.close()
}

func runRideCsvContract() throws {
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "shared/ride-export-contract.json"))) as! [String: Any]
  let fixture = root["csv"] as! [String: Any], initial = (root["csv"] as! [String: Any])["initial"] as! [Int64]
  let count = fixture["count"] as! Int, base = (root["baseMs"] as! NSNumber).int64Value
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ride-csv-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let queue = try DatabaseQueue(path: directory.appendingPathComponent("test.db").path)
  try TelemetryDatabase.migrator.migrate(queue)
  // Seed both full iOS-style keyframes and Android-style deltas, including explicit NULL clears.
  let columns = ["speed_centi_kmh", "battery_voltage_mv", "motor_current_ma", "battery_current_ma",
    "duty_permille", "pitch_centi_deg", "roll_centi_deg", "balance_pitch_centi_deg", "balance_current_ma",
    "erpm", "state", "switch_state", "adc1_milli", "adc2_milli", "odometer_cm", "temp_mosfet_deci_c", "temp_motor_deci_c"]
  func frame(_ db: Database, _ i: Int, board: String? = "board", recording: String? = "ride") throws {
    let key = i % (fixture["keyframeEvery"] as! Int) == 0
    var v: [Int64?] = key ? initial.map { $0 } : [Int64?](repeating: nil, count: 17)
    var mask = key ? (1 << 17) - 1 : 1
    v[0] = i == 1001 ? -90000 : Int64(i)
    if i == 3 || (key && i > 0) { v[16] = nil; mask |= 1 << 16 }
    switch i {
    case 1000: v[11] = 194; mask |= 1 << 11
    case 1001: v[11] = 225; v[12] = 1000; v[13] = 2000; mask |= 7 << 11
    case 1002: v[11] = 208; mask |= 1 << 11
    case 1003: v[11] = 243; mask |= 1 << 11
    default: break
    }
    var arguments: [DatabaseValueConvertible?] = [base + Int64(i / 2), i, board, recording, key ? 1 : 0, mask, 0]
    arguments += v.map { $0 as DatabaseValueConvertible? }
    try db.execute(sql: "INSERT INTO telemetry_frames (captured_at_ms, elapsed_realtime_ms, board_id, recording_id, flags, changed_mask_1, changed_mask_2, \(columns.joined(separator: ","))) VALUES (\(Array(repeating: "?", count: arguments.count).joined(separator: ",")))", arguments: StatementArguments(arguments))
  }
  func point(_ j: Int, timestamp: Int64? = nil, recording: String? = "ride", accuracy: Int? = 2000) -> RideTrackPoint {
    RideTrackPoint(recordingId: recording, boardId: "board", fixAtMs: timestamp ?? base + 100 + Int64(j / 2),
      latitudeE7: Int64(521234567 + j), longitudeE7: -211234567, accuracyCm: accuracy,
      gpsSpeedCentiMps: 456, bearingCentiDeg: nil, altitudeCm: -1234)
  }
  try queue.write { db in
    for i in 0..<count { try frame(db, i) }
    try frame(db, 0, board: "other"); try frame(db, 0, recording: "other"); try frame(db, 0, board: nil)
    for _ in 0...1100 { try insertRideTrackPoint(db, point(0, timestamp: base + 10, accuracy: 2001)) }
    for j in 0...1005 { try insertRideTrackPoint(db, point(j)) }
    try insertRideTrackPoint(db, point(0, timestamp: base + 5, recording: nil, accuracy: nil))
    try insertRideTrackPoint(db, point(0, timestamp: base + 2, accuracy: nil))
  }
  func export(board: String? = "board", recording: String? = "ride", from: Int64? = nil, to: Int64? = nil) throws -> [[String]] {
    var options: [String: Any] = ["fromMs": from ?? base + 1, "toMs": to ?? base + Int64((count - 2) / 2)]
    options["boardId"] = board; options["recordingId"] = recording
    let result = try queue.read { try RideExport.csv($0, directory: directory, options: options) }
    try require(result["mimeType"] as! String == "text/csv" && result["uti"] as! String == "public.comma-separated-values-text", "CSV share types")
    let text = try String(contentsOf: URL(string: result["uri"] as! String)!, encoding: .utf8)
    let lines = text.components(separatedBy: "\r\n").dropLast()
    try require(lines.first! == fixture["headers"] as! String, "stable CSV headers")
    return lines.dropFirst().map { $0.components(separatedBy: ",") }
  }
  let rows = try export()
  try require(rows.count == count - 3, "complete CSV exceeds chart cap")
  for (offset, row) in rows.enumerated() {
    let i = offset + 2, j = i / 2 < 100 ? 0 : min(1005, 2 * (i / 2 - 100) + 1)
    try require(Int64(row[0])! == base + Int64(i / 2), "telemetry timestamp and equal-time ordering")
    try require(Double(row[1])! == Double(i == 1001 ? -90000 : i) / 100, "every retained speed including spike")
    try require(row.count == 26, "CSV row width")
    try require(Double(row[18])! == Double(521234567 + j) / 10_000_000, "GPS first previous final across pages")
    try require(Int64(row[22])! == base + 100 + Int64(j / 2), "GPS timestamp independent of telemetry")
    try require(row[6] == (i < 3 ? "43.2" : ""), "optional NULL delta and keyframe clears")
  }
  let first = rows[0]
  try require(Array(first[2..<18]) == ["0.789", "84.25", "3.456", "-12.345", "43.2", "32.1", "1234.56", "2.34", "-3.45", "-1.23", "7", "1", "10", "2.1", "1.1", "-12.34"], "CSV stored units pitch and packed state")
  try require(Array(first[20..<22]) == ["20.0", "4.56"], "GPS accuracy metres and speed m/s")
  try require(Array(first[23..<26]) == ["-6789", "4.567", "177"], "stored Vescape additions")
  try require((1000...1003).map { rows[$0 - 2][13] } == ["3", "2", "0", ""], "switch flag masking and Floaty enum")
  try require(rows[5000 - 2][13] == "1", "keyframe resets carried switch")
  let unassigned = try export(board: nil, from: base, to: base)
  try require(unassigned.count == 1 && unassigned[0][17..<23].allSatisfy { $0.isEmpty }, "exact null Board and no GPS retains telemetry")
  try require(export(board: "empty").isEmpty, "empty telemetry header only")
  try require(Int64(export(recording: nil)[0][22])! == base + 5, "legacy missing accuracy accepted")
  try require(export(from: base + 1200, to: base + 1200)[0][3] == "84.25", "predecessor replay across pages")
  try queue.write { db in
    try frame(db, 0)
    try db.execute(sql: "UPDATE telemetry_frames SET captured_at_ms = ?, battery_voltage_mv = 99000 WHERE id = last_insert_rowid()", arguments: [base + 1200])
    try insertRideTrackPoint(db, RideTrackPoint(recordingId: "ride", boardId: "gps-only", fixAtMs: base + 100,
      latitudeE7: 521234567, longitudeE7: -211234567, accuracyCm: 2000, gpsSpeedCentiMps: nil, bearingCentiDeg: nil, altitudeCm: nil))
  }
  try require(export(from: base + 1200, to: base + 1200).map { $0[3] } == ["84.25", "84.25", "99.0"], "keyframe at start cannot erase earlier equal-time deltas")
  try require(export(board: "gps-only").isEmpty, "GPS-only range creates no telemetry rows")
  let escape = (fixture["escapeInput"] as! [Any]).map { $0 is NSNull ? nil : $0 }
  try require(RideExport.csvLine(escape) == fixture["escapeExpected"] as! String, "CSV quote comma newline escaping")
  try queue.close()
}
