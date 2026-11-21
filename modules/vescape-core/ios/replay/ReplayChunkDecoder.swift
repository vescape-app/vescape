import Foundation

internal struct ReplayChunk {
  let t: Int64
  let bytes: [UInt8]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayChunkDecoder.kt `ReplayLocation`
internal struct ReplayLocation {
  let t: Int64
  let latitude: Double
  let longitude: Double
  let speedMps: Double?
  let bearingDeg: Double?
  let accuracyM: Double?
  let altitudeM: Double?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayChunkDecoder.kt
internal enum ReplayChunkDecoder {
  static func rxChunks(_ jsonl: String) -> [ReplayChunk] { chunks(jsonl, direction: "rx") }

  static func txChunks(_ jsonl: String) -> [ReplayChunk] { chunks(jsonl, direction: "tx") }

  private static func chunks(_ jsonl: String, direction: String) -> [ReplayChunk] {
    jsonl.split(separator: "\n").compactMap { line in
      guard
        let data = line.data(using: .utf8),
        // intentional-suppression: malformed replay lines are skipped individually
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        json["kind"] as? String == "ble-chunk",
        json["direction"] as? String == direction,
        let t = (json["t"] as? NSNumber)?.int64Value,
        let base64 = json["base64"] as? String,
        let bytes = Data(base64Encoded: base64)
      else { return nil }
      return ReplayChunk(t: t, bytes: [UInt8](bytes))
    }
  }

  static func locations(_ jsonl: String) -> [ReplayLocation] {
    jsonl.split(separator: "\n").compactMap { line in
      guard
        let data = line.data(using: .utf8),
        // intentional-suppression: malformed replay lines are skipped individually
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        json["kind"] as? String == "location",
        let t = (json["t"] as? NSNumber)?.int64Value,
        let latitude = (json["latitude"] as? NSNumber)?.doubleValue,
        let longitude = (json["longitude"] as? NSNumber)?.doubleValue
      else { return nil }
      return ReplayLocation(
        t: t,
        latitude: latitude,
        longitude: longitude,
        speedMps: (json["speedMps"] as? NSNumber)?.doubleValue,
        bearingDeg: (json["bearingDeg"] as? NSNumber)?.doubleValue,
        accuracyM: (json["accuracyM"] as? NSNumber)?.doubleValue,
        altitudeM: (json["altitudeM"] as? NSNumber)?.doubleValue
      )
    }
  }

  static func bmsFrames(_ jsonl: String) -> [BmsTelemetry] {
    let reassembler = VescPacketReassembler()
    return rxChunks(jsonl).flatMap { chunk in
      reassembler.feed(chunk.bytes).compactMap { packet in parseBmsValues(packet, packetAt: chunk.t) }
    }
  }
}
