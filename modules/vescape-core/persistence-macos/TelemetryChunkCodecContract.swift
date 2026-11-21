import Foundation

func runTelemetryChunkCodecContract() throws {
  let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "shared/telemetry-chunk-codec-contract.json"))) as! [String: Any]
  func longs(_ raw: Any?) -> [Int64?] { (raw as! [Any]).map { ($0 as? NSNumber)?.int64Value } }
  func sample(_ s: [String: Any], values: [Int64?]) -> TelemetrySample {
    TelemetrySample(capturedAtMs: (s["capturedAtMs"] as! NSNumber).int64Value,
      elapsedRealtimeMs: (s["elapsedRealtimeMs"] as! NSNumber).int64Value,
      canId: (s["canId"] as? NSNumber)?.int32Value, flags: (s["flags"] as! NSNumber).int32Value, values: values)
  }
  var chains = [String: [TelemetrySample]]()
  var produced = [[String: Any]]()
  for chain in fixture["chains"] as! [[String: Any]] {
    let name = chain["name"] as! String
    let expected = (chain["samples"] as! [[String: Any]]).map { sample($0, values: longs($0["values"])) }
    chains[name] = expected
    var values = [Int64?](repeating: nil, count: TELEMETRY_CHUNK_VALUE_COLUMNS)
    let reconstructed = (chain["frames"] as! [[String: Any]]).map { f -> TelemetrySample in
      reconstructTelemetryValues(&values, flags: (f["flags"] as! NSNumber).intValue,
        changedMask1: (f["changedMask1"] as! NSNumber).intValue, row: longs(f["values"]))
      return sample(f, values: values)
    }
    try require(reconstructed == expected, "chunk reconstruction \(name)")
    let blob = try TelemetryChunkCodec.encode(expected)
    try require(try TelemetryChunkCodec.decode(blob) == expected, "chunk round trip \(name)")
    produced.append(["chain": name, "producer": "ios", "base64": blob.base64EncodedString()])
  }
  if let path = ProcessInfo.processInfo.environment["VESCAPE_CHUNK_GOLDEN_OUT"] {
    try JSONSerialization.data(withJSONObject: produced, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: path))
  }
  let golden = fixture["goldenBlobs"] as! [[String: Any]]
  try require(Set(golden.map { $0["producer"] as! String }) == ["android", "ios"], "golden blobs from both platforms")
  for blob in golden {
    let decoded = try TelemetryChunkCodec.decode(Data(base64Encoded: blob["base64"] as! String)!)
    try require(decoded == chains[blob["chain"] as! String]!, "golden \(blob["producer"]!) \(blob["chain"]!) decodes")
  }
  for blob in fixture["rejectedBlobs"] as! [[String: Any]] {
    var rejected = false
    do { _ = try TelemetryChunkCodec.decode(Data(base64Encoded: blob["base64"] as! String)!) } catch is TelemetryChunkFormatError { rejected = true }
    try require(rejected, "rejects \(blob["name"]!)")
  }
  var wide = [Int64?](repeating: nil, count: TELEMETRY_CHUNK_VALUE_COLUMNS)
  wide[0] = Int64(Int32.max) + 1
  var overflowRejected = false
  do { _ = try TelemetryChunkCodec.encode([TelemetrySample(capturedAtMs: 0, elapsedRealtimeMs: 0, canId: nil, flags: 0, values: wide)]) }
  catch is TelemetryChunkFormatError { overflowRejected = true }
  try require(overflowRejected, "encoder rejects values outside declared width")
}
