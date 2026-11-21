import Compression
import Foundation

/// One reconstructed Telemetry Sample: every value column resolved, nothing sparse. `values` has
/// `TELEMETRY_CHUNK_VALUE_COLUMNS` entries in storage mask bit order (`changed_mask_1` bit i =
/// values[i]); nil is a missing reading.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkCodec.kt `TelemetrySample`
internal struct TelemetrySample: Equatable {
  var capturedAtMs: Int64
  var elapsedRealtimeMs: Int64
  var canId: Int32?
  var flags: Int32
  var values: [Int64?]
}

/// Value columns in `changed_mask_1` bit order, `speed_centi_kmh` .. `temp_motor_deci_c`.
internal let TELEMETRY_CHUNK_VALUE_COLUMNS = 17

/// Canonical reconstruction of a stored `telemetry_frames` row (ADR 0045): masks are authoritative.
/// A keyframe clears every column first and then counts as all bits set; otherwise a set bit replaces
/// the column with the row's value, NULL included (an explicit clear), and a clear bit keeps it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkCodec.kt `reconstructTelemetryValues`
internal func reconstructTelemetryValues(_ values: inout [Int64?], flags: Int, changedMask1: Int, row: [Int64?]) {
  let keyframe = flags & TELEMETRY_FLAG_KEYFRAME != 0
  if keyframe { values = [Int64?](repeating: nil, count: values.count) }
  for i in values.indices where keyframe || changedMask1 & (1 << i) != 0 { values[i] = row[i] }
}

internal struct TelemetryChunkFormatError: Error, CustomStringConvertible {
  let description: String
}

/// Telemetry Chunk codec v1. The codec invariants are in ADR 0045 and the golden contract in `shared/telemetry-chunk-codec-contract.json`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkCodec.kt `TelemetryChunkCodec`
/// @platform-diff Apple's raw-deflate encoder has a fixed level (5) instead of Android's 6; the
/// contract is decode equivalence, not identical bytes.
internal enum TelemetryChunkCodec {
  static let version: UInt8 = 1
  static let maxSamples = 65_536
  /// Worst case per sample: 21 ten-byte varints plus one presence bit for each of 18 nullable columns.
  private static let maxBodyBytesPerSample = 21 * 10 + 3
  /// Declared width per value column: `odometer_cm` is 64-bit, every other column 32-bit.
  private static let longColumn = 14

  static func encode(_ samples: [TelemetrySample]) throws -> Data {
    guard samples.count <= maxSamples else { throw TelemetryChunkFormatError(description: "too many samples: \(samples.count)") }
    let base = samples.first?.capturedAtMs ?? 0
    var body = [UInt8]()
    writeColumn(&body, start: base, samples.map(\.capturedAtMs))
    writeColumn(&body, start: 0, samples.map(\.elapsedRealtimeMs))
    writeColumn(&body, start: 0, samples.map { Int64($0.flags) })
    writeNullableColumn(&body, samples.map { $0.canId.map(Int64.init) })
    for column in 0..<TELEMETRY_CHUNK_VALUE_COLUMNS {
      let values = try samples.map { sample -> Int64? in
        guard sample.values.count == TELEMETRY_CHUNK_VALUE_COLUMNS else {
          throw TelemetryChunkFormatError(description: "sample needs \(TELEMETRY_CHUNK_VALUE_COLUMNS) values")
        }
        return sample.values[column]
      }
      if column != longColumn {
        for v in values.compactMap({ $0 }) where Int64(Int32(truncatingIfNeeded: v)) != v {
          throw TelemetryChunkFormatError(description: "column \(column) overflows 32 bits")
        }
      }
      writeNullableColumn(&body, values)
    }
    var out: [UInt8] = [version]
    writeVarint(&out, UInt64(samples.count))
    writeVarint(&out, zigzag(base))
    out += try stream(COMPRESSION_STREAM_ENCODE, input: body, maxOutput: nil)
    return Data(out)
  }

  static func decode(_ blob: Data) throws -> [TelemetrySample] {
    let bytes = [UInt8](blob)
    var header = Reader(bytes: bytes)
    guard !header.atEnd else { throw TelemetryChunkFormatError(description: "empty blob") }
    let v = try header.byte()
    guard v == version else { throw TelemetryChunkFormatError(description: "unknown version \(v)") }
    let countRaw = try header.varint()
    guard countRaw <= UInt64(maxSamples) else { throw TelemetryChunkFormatError(description: "bad sample count \(countRaw)") }
    let count = Int(countRaw)
    let base = unzigzag(try header.varint())
    let body = try stream(COMPRESSION_STREAM_DECODE, input: Array(bytes[header.position...]),
      maxOutput: count * maxBodyBytesPerSample + 16)
    var r = Reader(bytes: body)
    let captured = try readColumn(&r, count: count, start: base)
    let elapsed = try readColumn(&r, count: count, start: 0)
    let flags = try readColumn(&r, count: count, start: 0).map(narrow)
    let canIds = try readNullableColumn(&r, count: count).map { try $0.map(narrow) }
    var columns = [[Int64?]]()
    for column in 0..<TELEMETRY_CHUNK_VALUE_COLUMNS {
      let values = try readNullableColumn(&r, count: count)
      if column != longColumn { for v in values.compactMap({ $0 }) { _ = try narrow(v) } }
      columns.append(values)
    }
    guard r.atEnd else { throw TelemetryChunkFormatError(description: "trailing body bytes") }
    return (0..<count).map { i in
      TelemetrySample(capturedAtMs: captured[i], elapsedRealtimeMs: elapsed[i], canId: canIds[i],
        flags: flags[i], values: columns.map { $0[i] })
    }
  }

  /// Raw deflate (RFC 1951) through `COMPRESSION_ZLIB`. Decode stops past `maxOutput`; bytes after the
  /// final deflate block are ignored, because Apple's decoder does not report them.
  private static func stream(_ operation: compression_stream_operation, input: [UInt8], maxOutput: Int?) throws -> [UInt8] {
    let streamPointer = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
    defer { streamPointer.deallocate() }
    guard compression_stream_init(streamPointer, operation, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
      throw TelemetryChunkFormatError(description: "compression init failed")
    }
    defer { compression_stream_destroy(streamPointer) }
    let bufferSize = 8192
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    defer { buffer.deallocate() }
    var out = [UInt8]()
    return try input.withUnsafeBufferPointer { source -> [UInt8] in
      streamPointer.pointee.src_ptr = source.baseAddress ?? UnsafePointer(buffer)
      streamPointer.pointee.src_size = source.count
      while true {
        streamPointer.pointee.dst_ptr = buffer
        streamPointer.pointee.dst_size = bufferSize
        let status = compression_stream_process(streamPointer, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
        out.append(contentsOf: UnsafeBufferPointer(start: buffer, count: bufferSize - streamPointer.pointee.dst_size))
        if let maxOutput, out.count > maxOutput { throw TelemetryChunkFormatError(description: "body exceeds bound") }
        switch status {
        case COMPRESSION_STATUS_OK:
          // FINALIZE with an empty source and no output means the decoder wants more input.
          if streamPointer.pointee.src_size == 0, streamPointer.pointee.dst_size == bufferSize {
            throw TelemetryChunkFormatError(description: "truncated deflate stream")
          }
        case COMPRESSION_STATUS_END:
          return out
        default:
          throw TelemetryChunkFormatError(description: "corrupt deflate stream")
        }
      }
    }
  }

  private static func writeColumn(_ out: inout [UInt8], start: Int64, _ values: [Int64]) {
    var previous = start
    for v in values { writeVarint(&out, zigzag(v &- previous)); previous = v }
  }

  private static func writeNullableColumn(_ out: inout [UInt8], _ values: [Int64?]) {
    var bitmap = [UInt8](repeating: 0, count: (values.count + 7) / 8)
    for (i, v) in values.enumerated() where v != nil { bitmap[i / 8] |= 1 << (i % 8) }
    out += bitmap
    writeColumn(&out, start: 0, values.compactMap { $0 })
  }

  private static func readColumn(_ r: inout Reader, count: Int, start: Int64) throws -> [Int64] {
    var previous = start, values = [Int64]()
    values.reserveCapacity(count)
    for _ in 0..<count { previous = previous &+ unzigzag(try r.varint()); values.append(previous) }
    return values
  }

  private static func readNullableColumn(_ r: inout Reader, count: Int) throws -> [Int64?] {
    let bitmapStart = r.position
    try r.skip((count + 7) / 8)
    var previous: Int64 = 0, values = [Int64?]()
    values.reserveCapacity(count)
    for i in 0..<count {
      if r.bytes[bitmapStart + i / 8] & (1 << (i % 8)) == 0 { values.append(nil); continue }
      previous = previous &+ unzigzag(try r.varint())
      values.append(previous)
    }
    return values
  }

  private static func narrow(_ value: Int64) throws -> Int32 {
    guard let narrowed = Int32(exactly: value) else { throw TelemetryChunkFormatError(description: "value overflows 32 bits") }
    return narrowed
  }

  private static func zigzag(_ v: Int64) -> UInt64 { UInt64(bitPattern: (v << 1) ^ (v >> 63)) }
  private static func unzigzag(_ v: UInt64) -> Int64 { Int64(bitPattern: (v >> 1) ^ (0 &- (v & 1))) }

  private static func writeVarint(_ out: inout [UInt8], _ value: UInt64) {
    var v = value
    while v >= 0x80 { out.append(UInt8(v & 0x7F) | 0x80); v >>= 7 }
    out.append(UInt8(v))
  }

  private struct Reader {
    let bytes: [UInt8]
    var position = 0
    var atEnd: Bool { position >= bytes.count }
    mutating func byte() throws -> UInt8 {
      guard position < bytes.count else { throw TelemetryChunkFormatError(description: "truncated") }
      defer { position += 1 }
      return bytes[position]
    }
    mutating func skip(_ n: Int) throws {
      guard bytes.count - position >= n else { throw TelemetryChunkFormatError(description: "truncated") }
      position += n
    }
    /// Unsigned LEB128, at most 10 bytes; the tenth may only carry the top bit.
    mutating func varint() throws -> UInt64 {
      var result: UInt64 = 0
      for i in 0..<10 {
        let b = try byte()
        if i == 9 && b > 1 { throw TelemetryChunkFormatError(description: "varint overflow") }
        result |= UInt64(b & 0x7F) << (7 * UInt64(i))
        if b & 0x80 == 0 { return result }
      }
      throw TelemetryChunkFormatError(description: "varint overflow")
    }
  }
}
