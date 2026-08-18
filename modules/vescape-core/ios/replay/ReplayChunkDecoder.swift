import Foundation

/// One recorded incoming BLE chunk: milliseconds since recording start plus the raw bytes.
internal struct ReplayChunk {
  let t: Int64
  let bytes: [UInt8]
}

/// One recorded GPS fix, replayed in place of the phone's own. A replay reproduces the ride that was
/// recorded, and position is the centre of that ride — so the recording owns it outright.
///
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

/// One recorded compass reading, replayed in place of the phone's own magnetometer. The phone that
/// plays a recording back is usually lying still on a desk, so without these the heading cone and
/// Compass follow have nothing real to read.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayChunkDecoder.kt `ReplayHeading`
internal struct ReplayHeading {
  let t: Int64
  let headingDeg: Double
}

/// Pure decode core for Debug Recording replay (ADR 0024): turns a `.jsonl` Debug Recording into the
/// byte stream and decoded frames the session stack originally saw. Shared by the unit replay
/// harness (test source) and the dev-mode ReplayTransport. `ble-chunk` lines with
/// `direction == "rx"` carry the board stream and `location` lines carry the ride's GPS track;
/// every other kind (meta, session-state, tx traffic) and any malformed line — real recordings can
/// end mid-write — is skipped, never fatal.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayChunkDecoder.kt
internal enum ReplayChunkDecoder {
  /// Recorded `rx` chunks in file order with their recorded time offsets.
  static func rxChunks(_ jsonl: String) -> [ReplayChunk] {
    jsonl.split(separator: "\n").compactMap { line in
      guard
        let data = line.data(using: .utf8),
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        json["kind"] as? String == "ble-chunk",
        json["direction"] as? String == "rx",
        let t = (json["t"] as? NSNumber)?.int64Value,
        let base64 = json["base64"] as? String,
        let bytes = Data(base64Encoded: base64)
      else { return nil }
      return ReplayChunk(t: t, bytes: [UInt8](bytes))
    }
  }

  /// Recorded GPS fixes in file order with their recorded time offsets.
  static func locations(_ jsonl: String) -> [ReplayLocation] {
    jsonl.split(separator: "\n").compactMap { line in
      guard
        let data = line.data(using: .utf8),
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

  /// Recorded compass readings in file order with their recorded time offsets.
  static func headings(_ jsonl: String) -> [ReplayHeading] {
    jsonl.split(separator: "\n").compactMap { line in
      guard
        let data = line.data(using: .utf8),
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        json["kind"] as? String == "phone-heading",
        let t = (json["t"] as? NSNumber)?.int64Value,
        let headingDeg = (json["headingDeg"] as? NSNumber)?.doubleValue
      else { return nil }
      return ReplayHeading(t: t, headingDeg: headingDeg)
    }
  }

  /// Decoded smart-BMS frames with the recorded chunk time as `capturedAt`, produced by running the
  /// recorded `rx` bytes through the real packet reassembler and BMS parser.
  static func bmsFrames(_ jsonl: String) -> [BmsTelemetry] {
    let reassembler = VescPacketReassembler()
    return rxChunks(jsonl).flatMap { chunk in
      reassembler.feed(chunk.bytes).compactMap { packet in parseBmsValues(packet, packetAt: chunk.t) }
    }
  }
}
