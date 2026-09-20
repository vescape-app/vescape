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
