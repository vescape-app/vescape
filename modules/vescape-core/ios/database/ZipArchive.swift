import Compression
import Foundation

/// Minimal, dependency-free ZIP support for database backups. Writes STORED (uncompressed)
/// entries — valid zip that both platforms read — and reads STORED + DEFLATE entries so an
/// Android backup (which deflates) can also be restored on iOS.
///
/// Only the handful of features a `manifest.json` + `db.sqlite` archive needs are implemented; it
/// is not a general-purpose zip library.
///
/// @platform-diff No Android peer: Android zips via `java.util.zip` inside
/// `database/DatabaseBackupManager.kt`; iOS ships this minimal pure-Swift implementation so
/// cross-platform backups stay readable on both sides.
enum ZipArchive {
  struct Entry {
    let name: String
    let data: Data
  }

  enum ZipError: Error {
    case malformed(String)
    case unsupportedCompression(UInt16)
    case inflateFailed
  }

  // MARK: - Writing (STORED)

  static func archive(entries: [Entry]) -> Data {
    var output = Data()
    var central = Data()
    var offsets: [(entry: Entry, crc: UInt32, offset: UInt32)] = []

    for entry in entries {
      let nameBytes = Array(entry.name.utf8)
      let crc = crc32(entry.data)
      let localOffset = UInt32(output.count)

      output.append(le32: 0x0403_4b50)
      output.append(le16: 20) // version needed
      output.append(le16: 0)  // flags
      output.append(le16: 0)  // method: stored
      output.append(le16: 0)  // mod time
      output.append(le16: 0)  // mod date
      output.append(le32: crc)
      output.append(le32: UInt32(entry.data.count)) // compressed size
      output.append(le32: UInt32(entry.data.count)) // uncompressed size
      output.append(le16: UInt16(nameBytes.count))
      output.append(le16: 0) // extra length
      output.append(contentsOf: nameBytes)
      output.append(entry.data)

      offsets.append((entry, crc, localOffset))
    }

    for record in offsets {
      let nameBytes = Array(record.entry.name.utf8)
      central.append(le32: 0x0201_4b50)
      central.append(le16: 20) // version made by
      central.append(le16: 20) // version needed
      central.append(le16: 0)  // flags
      central.append(le16: 0)  // method: stored
      central.append(le16: 0)  // mod time
      central.append(le16: 0)  // mod date
      central.append(le32: record.crc)
      central.append(le32: UInt32(record.entry.data.count))
      central.append(le32: UInt32(record.entry.data.count))
      central.append(le16: UInt16(nameBytes.count))
      central.append(le16: 0) // extra
      central.append(le16: 0) // comment
      central.append(le16: 0) // disk start
      central.append(le16: 0) // internal attrs
      central.append(le32: 0) // external attrs
      central.append(le32: record.offset)
      central.append(contentsOf: nameBytes)
    }

    let centralOffset = UInt32(output.count)
    output.append(central)

    output.append(le32: 0x0605_4b50)
    output.append(le16: 0) // disk number
    output.append(le16: 0) // central dir start disk
    output.append(le16: UInt16(offsets.count))
    output.append(le16: UInt16(offsets.count))
    output.append(le32: UInt32(central.count))
    output.append(le32: centralOffset)
    output.append(le16: 0) // comment length
    return output
  }

  // MARK: - Reading (STORED + DEFLATE)

  static func entries(from data: Data) throws -> [String: Data] {
    let bytes = [UInt8](data)
    guard let eocd = findEndOfCentralDirectory(bytes) else {
      throw ZipError.malformed("End of central directory not found")
    }
    let count = readLE16(bytes, eocd + 10)
    var offset = Int(readLE32(bytes, eocd + 16))
    var result: [String: Data] = [:]

    for _ in 0..<count {
      guard offset + 46 <= bytes.count, readLE32(bytes, offset) == 0x0201_4b50 else {
        throw ZipError.malformed("Bad central directory header")
      }
      let method = readLE16(bytes, offset + 10)
      let compressedSize = Int(readLE32(bytes, offset + 20))
      let uncompressedSize = Int(readLE32(bytes, offset + 24))
      let nameLen = Int(readLE16(bytes, offset + 28))
      let extraLen = Int(readLE16(bytes, offset + 30))
      let commentLen = Int(readLE16(bytes, offset + 32))
      let localHeaderOffset = Int(readLE32(bytes, offset + 42))
      let nameStart = offset + 46
      guard nameStart + nameLen <= bytes.count else { throw ZipError.malformed("Truncated name") }
      let name = String(decoding: bytes[nameStart..<nameStart + nameLen], as: UTF8.self)

      // Local header carries its own extra-field length; the data begins after it.
      guard localHeaderOffset + 30 <= bytes.count, readLE32(bytes, localHeaderOffset) == 0x0403_4b50 else {
        throw ZipError.malformed("Bad local header for \(name)")
      }
      let localNameLen = Int(readLE16(bytes, localHeaderOffset + 26))
      let localExtraLen = Int(readLE16(bytes, localHeaderOffset + 28))
      let dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
      guard dataStart + compressedSize <= bytes.count else { throw ZipError.malformed("Truncated data for \(name)") }
      let compressed = Data(bytes[dataStart..<dataStart + compressedSize])

      switch method {
      case 0:
        result[name] = compressed
      case 8:
        guard let inflated = inflate(compressed, expectedSize: uncompressedSize) else {
          throw ZipError.inflateFailed
        }
        result[name] = inflated
      default:
        throw ZipError.unsupportedCompression(method)
      }

      offset = nameStart + nameLen + extraLen + commentLen
    }
    return result
  }

  private static func findEndOfCentralDirectory(_ bytes: [UInt8]) -> Int? {
    guard bytes.count >= 22 else { return nil }
    // No zip comment in our archives, but scan a small window to be safe.
    let minStart = max(0, bytes.count - 22 - 0xFFFF)
    var index = bytes.count - 22
    while index >= minStart {
      if readLE32(bytes, index) == 0x0605_4b50 { return index }
      index -= 1
    }
    return nil
  }

  private static func inflate(_ data: Data, expectedSize: Int) -> Data? {
    guard expectedSize > 0 else { return Data() }
    return data.withUnsafeBytes { raw -> Data? in
      guard let src = raw.bindMemory(to: UInt8.self).baseAddress else { return nil }
      let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: expectedSize)
      defer { dst.deallocate() }
      let written = compression_decode_buffer(dst, expectedSize, src, data.count, nil, COMPRESSION_ZLIB)
      guard written == expectedSize else { return nil }
      return Data(bytes: dst, count: written)
    }
  }

  // MARK: - Byte helpers

  private static func readLE16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
    UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
  }

  private static func readLE32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
    UInt32(bytes[offset]) | (UInt32(bytes[offset + 1]) << 8)
      | (UInt32(bytes[offset + 2]) << 16) | (UInt32(bytes[offset + 3]) << 24)
  }

  private static let crcTable: [UInt32] = {
    (0..<256).map { i -> UInt32 in
      var c = UInt32(i)
      for _ in 0..<8 {
        c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1
      }
      return c
    }
  }()

  private static func crc32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xFFFF_FFFF
    for byte in data {
      crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
    }
    return crc ^ 0xFFFF_FFFF
  }
}

private extension Data {
  mutating func append(le16 value: UInt16) {
    append(UInt8(value & 0xFF))
    append(UInt8((value >> 8) & 0xFF))
  }

  mutating func append(le32 value: UInt32) {
    append(UInt8(value & 0xFF))
    append(UInt8((value >> 8) & 0xFF))
    append(UInt8((value >> 16) & 0xFF))
    append(UInt8((value >> 24) & 0xFF))
  }
}
